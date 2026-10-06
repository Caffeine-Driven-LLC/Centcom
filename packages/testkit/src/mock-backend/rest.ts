import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { ERROR_TABLE, OPERATIONS, b64u, compareVersions, type ErrorCode, type Id } from '@centcom/protocol';
import { jwks, signJwt, verifyJwt, type KeyPair } from '../core/jwt.js';
import type { Clock } from '../core/clock.js';
import type { Rng } from '../core/prng.js';
import { deref, generate, resolve } from './schema-gen.js';
import { problem } from './problem.js';
import type { MockState, SessionRec } from './state.js';

type Doc = Record<string, any>;
export interface Result { status: number; body?: unknown; headers?: Record<string, string> }
export interface RestDeps { clock: Clock; rng: Rng; doc: Doc; state: MockState; keys: KeyPair[]; newId: <P extends 'usr' | 'dev' | 'ses' | 'mem' | 'req' | 'wsp' | 'msg'>(p: P) => Id<P>; wsUrl: () => string; issueTicket: (sid: string, o?: { name?: string; role?: 'host' | 'editor' | 'viewer'; user?: string; device?: string }) => { ticket: string; member: Record<string, unknown> }; getOrCreateSession: (id: string) => SessionRec }

const OPS = Object.entries(OPERATIONS).map(([id, o]) => ({ id, ...(o as { method: string; path: string; public: boolean; tags: readonly string[] }) }));
interface Route { id: string; method: string; re: RegExp; keys: string[]; public: boolean; statics: number }
const routes: Route[] = OPS.map((o) => { const keys: string[] = []; const re = new RegExp('^' + o.path.replace(/[.+*?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_m, k: string) => { keys.push(k); return '([^/]+)'; }) + '$'); return { id: o.id, method: o.method, re, keys, public: o.public, statics: o.path.split('/').filter((s) => !s.startsWith('{')).length }; }).sort((a, b) => b.statics - a.statics);

const SECRET_ENDPOINTS = new Set(['createCheckout', 'createInvite', 'ingestUsageEvents', 'createWebhook']); // Idempotency-Key is required here (CT-PAGE)
const BIG_BODY = new Set(['ingestUsageEvents']);

export function createRest(d: RestDeps) {
  const { clock, rng, doc, state } = d;
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true }); ajv.addSchema({ $id: 'oa', components: doc.components });
  const validators = new Map<string, ReturnType<Ajv2020['compile']>>();
  const validatorFor = (ref: string) => { let v = validators.get(ref); if (!v) { v = ajv.compile({ $ref: `oa#/components/schemas/${ref}` }); validators.set(ref, v); } return v; };
  const gctx = { doc, rng, now: () => clock.now() };
  const opDef = (id: string): Doc => { for (const item of Object.values<Doc>(doc.paths)) for (const o of Object.values<Doc>(item)) if (o?.operationId === id) return o; throw new Error('unknown op ' + id); };
  const okStatus = (op: Doc) => Number(Object.keys(op.responses).filter((s) => /^[23]/.test(s)).sort()[0] ?? 200);
  const respSchema = (op: Doc, status: number): Doc | undefined => { const r = deref(doc, op.responses[String(status)] ?? {}); return r?.content?.['application/json']?.schema; };
  const rid = () => d.newId('req');
  const fail = (code: ErrorCode, requestId: string, o: Parameters<typeof problem>[2] = {}): Result => { const p = problem(code, requestId, o); const h: Record<string, string> = {}; if (p.retry_after_s !== undefined) h['Retry-After'] = String(p.retry_after_s); return { status: p.status, body: p, headers: { 'content-type': 'application/problem+json', ...h } }; };

  /* ---------------- tokens ---------------- */
  const issueTokens = (user: Id<'usr'>, device: Id<'dev'>, fam?: ReturnType<typeof newFamily>) => {
    const now = Math.floor(clock.now() / 1000); const access = signJwt(d.keys[0]!, { iss: 'https://api.centcom.dev', aud: 'centcom-api', sub: user, dev: device, iat: now, exp: now + 900, jti: d.newId('req') });
    const f = fam ?? newFamily(user, device); const refresh = `rt_${b64u.encode(rng.bytes(24))}`; f.old.add(f.current); f.current = refresh;
    return { access_token: access, token_type: 'Bearer', expires_in: 900, refresh_token: refresh, scope: 'sessions workspaces', user, device };
  };
  function newFamily(user: Id<'usr'>, device: Id<'dev'>) { const f = { id: d.newId('req') as string, user, device, current: '', old: new Set<string>(), revoked: false }; state.families.set(f.id, f); return f; }

  /* ---------------- hand-written behaviour ---------------- */
  type H = (c: { rq: Rec; requestId: string; params: Record<string, string>; query: URLSearchParams; body: any; sub?: string; dev?: string }) => Result | undefined;
  interface Rec { method: string; path: string; headers: Record<string, string> }
  const handlers: Record<string, H> = {
    getJwks: () => ({ status: 200, body: jwks(d.keys), headers: { 'cache-control': 'public, max-age=300' } }),
    startDeviceAuthorization: ({ requestId }) => {
      const dc = { device_code: `dc_${b64u.encode(rng.bytes(24))}`, user_code: `${fromSet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4)}-${fromSet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4)}`, state: 'pending' as const, expiresAt: clock.now() + 900_000, interval: 5, lastPoll: 0, polls: 0, approveAfterPolls: 2 };
      state.deviceCodes.set(dc.device_code, dc); void requestId;
      return { status: 200, body: { device_code: dc.device_code, user_code: dc.user_code, verification_uri: 'https://centcom.dev/device', verification_uri_complete: `https://centcom.dev/device?user_code=${dc.user_code}`, expires_in: 900, interval: dc.interval } };
    },
    issueToken: ({ requestId, body }) => {
      const g = body?.grant_type;
      if (g === 'urn:ietf:params:oauth:grant-type:device_code') {
        const dc = state.deviceCodes.get(body.device_code); if (!dc) return fail('invalid_grant', requestId);
        if (clock.now() > dc.expiresAt) return fail('expired_token', requestId);
        if (dc.state === 'denied') return fail('access_denied', requestId);
        const early = dc.lastPoll && clock.now() - dc.lastPoll < dc.interval * 1000; dc.lastPoll = clock.now(); dc.polls++;
        if (early) { dc.interval += 5; return fail('slow_down', requestId, { retryAfterS: dc.interval }); }
        if (dc.state === 'pending' && dc.polls >= dc.approveAfterPolls + 1 && dc.approveAfterPolls >= 0) dc.state = 'approved';
        if (dc.state === 'pending') return fail('authorization_pending', requestId, { retryAfterS: dc.interval });
        state.deviceCodes.delete(dc.device_code); const dev = d.newId('dev'); state.devices.set(dev, { id: dev, name: 'Mock device', revoked: false }); return { status: 200, body: issueTokens(state.user.id, dev) };
      }
      if (g === 'refresh_token') {
        const tok = String(body.refresh_token ?? ''); const fam = [...state.families.values()].find((f) => f.current === tok || f.old.has(tok));
        if (!fam || fam.revoked) return fail('invalid_grant', requestId);
        if (fam.old.has(tok)) { fam.revoked = true; return fail('refresh_reuse_detected', requestId); } // a used token came back: the whole family dies
        const dev = state.devices.get(fam.device); if (dev?.revoked) return fail('device_revoked', requestId);
        return { status: 200, body: issueTokens(fam.user, fam.device, fam) };
      }
      if (g === 'authorization_code') { const dev = d.newId('dev'); state.devices.set(dev, { id: dev, name: 'Mock browser', revoked: false }); return { status: 200, body: issueTokens(state.user.id, dev) }; }
      return fail('invalid_request', requestId, { detail: 'Unsupported grant_type.' });
    },
    revokeToken: ({ body }) => { const t = String(body?.token ?? ''); const fam = [...state.families.values()].find((f) => f.current === t || f.old.has(t)); if (fam) fam.revoked = true; else state.revokedTokens.add(t); return { status: 200, body: {} }; },
    getMe: (c) => ({ status: 200, body: { ...(generate(respSchema(opDef('getMe'), 200) ?? {}, gctx) as Doc), id: state.user.id, email: state.user.email, display_name: state.user.name }, headers: { etag: etagFor(c.rq.path, state.user) } }),
    createSession: ({ body }) => { const id = d.newId('ses'); const s = d.getOrCreateSession(id); if (typeof body?.name === 'string') s.name = body.name; if (body?.mode) s.mode = body.mode; return { status: 201, body: { ...(generate(respSchema(opDef('createSession'), 201) ?? {}, gctx) as Doc), id, state: s.state, mode: s.mode, name: s.name } }; },
    getSession: ({ params }) => { const s = d.getOrCreateSession(params.id!); return { status: 200, body: { ...(generate(respSchema(opDef('getSession'), 200) ?? {}, gctx) as Doc), id: s.id, state: s.state, mode: s.mode } }; },
    createJoinToken: ({ params, sub }) => { const s = d.getOrCreateSession(params.id!); if (s.state === 'ended') return undefined; const { ticket, member } = d.issueTicket(s.id, { user: sub }); return { status: 200, body: { ...(generate(respSchema(opDef('createJoinToken'), 200) ?? {}, gctx) as Doc), relay_url: d.wsUrl(), ticket, expires_at: new Date(clock.now() + 60_000).toISOString(), member: member.id } }; },
    endSession: ({ params }) => { const s = d.getOrCreateSession(params.id!); s.state = 'ended'; return { status: 200, body: { ...(generate(respSchema(opDef('endSession'), 200) ?? {}, gctx) as Doc), id: s.id, state: 'ended' } }; },
  };
  function fromSet(set: string, n: number) { let s = ''; for (let i = 0; i < n; i++) s += set[rng.int(set.length)]; return s; }
  const etagFor = (path: string, value: unknown) => { const e = `"${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)}"`; state.etags.set(path, e); return e; };

  /* ---------------- generic behaviour ---------------- */
  const pageDataset = (key: string, itemSchema: Doc, n = 47): unknown[] => { let ds = state.datasets.get(key); if (!ds) { ds = Array.from({ length: n }, () => generate(itemSchema, gctx)); state.datasets.set(key, ds); } return ds; };
  function generic(id: string, op: Doc, q: URLSearchParams, requestId: string, pathKey: string): Result {
    const status = okStatus(op); const schema = respSchema(op, status);
    if (status === 204 || !schema) return { status, ...(status === 204 ? {} : { body: {} }) };
    const s = deref(doc, schema); const props = (s.allOf ? Object.assign({}, ...s.allOf.map((p: Doc) => deref(doc, p).properties ?? {})) : s.properties) ?? {};
    if (props.data?.type === 'array' && props.next_cursor) { // a list endpoint: honour limit and cursor
      const limit = Number(q.get('limit') ?? 50); if (!Number.isInteger(limit) || limit < 1 || limit > 200) return fail('invalid_request', requestId, { detail: 'limit must be 1 to 200.', errors: [{ pointer: '/limit', code: 'out_of_range' }] });
      const fp = createHash('sha256').update(pathKey + [...q.entries()].filter(([k]) => k !== 'cursor' && k !== 'limit').map((e) => e.join('=')).join('&')).digest('hex').slice(0, 12);
      let off = 0; const cur = q.get('cursor');
      if (cur) { try { const c = JSON.parse(Buffer.from(b64u.decode(cur)).toString()); if (c.f !== fp || c.exp < clock.now() || !Number.isInteger(c.o)) throw new Error('x'); off = c.o; } catch { return fail('cursor_invalid', requestId); } }
      const all = pageDataset(id + ':' + fp, props.data.items); const slice = all.slice(off, off + limit); const more = off + limit < all.length;
      return { status, body: { data: slice, next_cursor: more ? b64u.encode(Buffer.from(JSON.stringify({ o: off + limit, f: fp, exp: clock.now() + 86_400_000 }))) : null, has_more: more } };
    }
    return { status, body: generate(schema, gctx), headers: op.responses[String(status)]?.headers?.ETag || props.etag ? {} : {} };
  }

  /* ---------------- request pipeline ---------------- */
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = (req.headers['x-request-id'] as string | undefined)?.match(/^req_[0-9A-HJKMNP-TV-Z]{26}$/) ? (req.headers['x-request-id'] as string) : rid();
    const send = (r: Result) => {
      const body = r.body === undefined ? undefined : JSON.stringify(r.body); const reset = Math.max(1, Math.ceil((60_000 - (clock.now() % 60_000)) / 1000));
      res.writeHead(r.status, { 'content-type': 'application/json', 'x-request-id': requestId, 'ratelimit-limit': '600', 'ratelimit-remaining': String(state.rateLimit?.remaining ?? 599), 'ratelimit-reset': String(reset), ...(r.headers ?? {}) }); res.end(body);
    };
    try {
      const url = new URL(req.url ?? '/', 'http://x'); const method = (req.method ?? 'GET').toUpperCase();
      let route: Route | undefined; let m: RegExpExecArray | null = null; for (const r of routes) if (r.method === method && (m = r.re.exec(url.pathname))) { route = r; break; }
      if (!route) { const other = routes.some((r) => r.re.test(url.pathname)); return send(fail(other ? 'invalid_request' : 'not_found', requestId, { status: other ? 405 : 404, detail: other ? 'Method not allowed.' : undefined, instance: url.pathname })); }
      const params: Record<string, string> = {}; route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m![i + 1]!); });
      const op = opDef(route.id); const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v ?? '')]));
      // body
      const limit = BIG_BODY.has(route.id) ? 1 << 20 : 256 * 1024; const chunks: Buffer[] = []; let size = 0; let tooBig = false;
      for await (const c of req) { size += (c as Buffer).length; if (size > limit) { tooBig = true; break; } chunks.push(c as Buffer); }
      if (tooBig) return send(fail('payload_too_large', requestId, { instance: url.pathname }));
      // maintenance / client version / injected errors / rate limit
      if (state.maintenance && route.id !== 'getStatus' && route.id !== 'getHealth') return send(fail('service_unavailable', requestId, { retryAfterS: 30 }));
      const ua = /centcom-(?:cli|tui|web)\/(\d+\.\d+\.\d+[^\s]*)/.exec(headers['user-agent'] ?? ''); if (state.minClient && ua && compareVersions(ua[1]!, state.minClient) < 0) return send(fail('client_too_old', requestId, { detail: `Update to ${state.minClient} or newer.` }));
      const inj = state.pendingErrors.shift(); if (inj) return send(fail(inj.code, requestId, { retryAfterS: inj.retryAfterS, instance: url.pathname }));
      if (state.rateLimit && state.rateLimit.remaining <= 0) return send(fail('rate_limited', requestId, { retryAfterS: state.rateLimit.retryAfterS }));
      if (state.rateLimit) state.rateLimit.remaining--;
      // auth
      let sub: string | undefined, dev: string | undefined;
      if (!route.public) {
        const auth = headers.authorization; if (!auth?.startsWith('Bearer ')) return send(fail('unauthorized', requestId, { instance: url.pathname }));
        const tok = auth.slice(7); const v = verifyJwt(d.keys, tok, { now: clock.now(), aud: 'centcom-api' });
        if (!v.ok) return send(fail(v.reason === 'expired' ? 'token_expired' : 'token_invalid', requestId, { instance: url.pathname }));
        if (state.revokedTokens.has(tok)) return send(fail('token_revoked', requestId)); if (state.devices.get(v.claims.dev)?.revoked) return send(fail('device_revoked', requestId));
        sub = v.claims.sub; dev = v.claims.dev;
      }
      const key = headers['idempotency-key']; if (SECRET_ENDPOINTS.has(route.id) && !key) return send(fail('idempotency_key_required', requestId));
      // JSON body
      let body: any; const raw = Buffer.concat(chunks).toString('utf8'); const ctype = (headers['content-type'] ?? '').split(';')[0]!.trim();
      if (raw) { try { body = ctype === 'application/x-www-form-urlencoded' ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw); } catch { return send(fail('invalid_request', requestId, { detail: 'The body is not valid JSON.' })); } }
      const rb = op.requestBody && deref(doc, op.requestBody); const bodySchemaRef: string | undefined = (rb?.content?.['application/json'] ?? rb?.content?.['application/x-www-form-urlencoded'])?.schema?.$ref?.split('/').pop();
      if (rb && bodySchemaRef) {
        if (body === undefined) { if (rb.required) return send(fail('invalid_request', requestId, { detail: 'A body is required.' })); }
        else { const val = validatorFor(bodySchemaRef); if (!val(body)) return send(fail('validation_failed', requestId, { instance: url.pathname, errors: (val.errors ?? []).slice(0, 20).map((e) => ({ pointer: e.instancePath || '', code: e.keyword, detail: e.message })) })); }
      }
      // idempotency
      const mutating = method === 'POST';
      let fp = '';
      if (key && mutating) {
        fp = createHash('sha256').update(method + url.pathname + JSON.stringify(body ?? null)).digest('hex'); const k = `${sub ?? 'anon'}:${key}`;
        for (const [ik, rec] of state.idem) if (clock.now() - rec.at > 86_400_000) state.idem.delete(ik);
        const prior = state.idem.get(k); if (prior) return send(prior.fingerprint === fp ? { status: prior.status, body: prior.body, headers: { ...prior.headers, 'idempotency-replayed': 'true' } } : fail('idempotency_conflict', requestId));
      }
      // conditional writes
      const ifMatch = headers['if-match']; if (ifMatch && ['PATCH', 'PUT', 'DELETE'].includes(method)) { const cur = state.etags.get(url.pathname); if (cur && cur !== ifMatch) return send(fail('precondition_failed', requestId)); }
      let result = handlers[route.id]?.({ rq: { method, path: url.pathname, headers }, requestId, params, query: url.searchParams, body, sub, dev }) ?? generic(route.id, op, url.searchParams, requestId, url.pathname);
      if (result.status < 400 && method === 'GET' && !result.headers?.etag && result.body && typeof result.body === 'object' && !('has_more' in (result.body as object))) result = { ...result, headers: { ...result.headers, etag: etagFor(url.pathname, result.body) } };
      if (result.status < 400 && ['PATCH', 'PUT'].includes(method) && result.body) result = { ...result, headers: { ...result.headers, etag: etagFor(url.pathname, result.body) } };
      if (key && mutating && fp) state.idem.set(`${sub ?? 'anon'}:${key}`, { fingerprint: fp, status: result.status, body: result.body, headers: result.headers ?? {}, at: clock.now() });
      send(result);
    } catch (e) { send(fail('internal_error', requestId, { detail: 'The mock backend hit a bug.' })); process.stderr.write(`mock rest error: ${(e as Error).stack}\n`); }
  }
  void resolve;
  return { handle, opDef, validatorFor };
}
export type { Server };
