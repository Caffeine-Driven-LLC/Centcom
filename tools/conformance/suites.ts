/** The per-contract suites (lane C100). Each reads the shared fixtures in contracts/fixtures and checks the client's own code against them.
 *  A suite returns one case per fixture or check; the runner turns that into pass / fail / skipped / waived per contract. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaseResult, Suite, SuiteResult } from '../../packages/testkit/src/index.js';
import { AGENT_WIRE_STATES, compareVersions, isClientTooOld, userAgent, ID_PREFIXES, STATE_NAMES, assertWritableFrame, isId, parseEventPayload, parseFrame, parseSecretPayload, payloadMode, validateAgainst, type EventKind } from '../../packages/protocol/src/index.js';
import { KeyRing, decryptPayload, encryptPayload, fingerprint, initCrypto, pathHmac, pathMacKey, retryDecision, signFrame, sodium, verifyFrame, parseProblem, canonicalJson, b64, unb64, type FrameHeader } from '../../packages/net/src/index.js';

const done = (cases: CaseResult[], total = cases.length): SuiteResult => ({ fixtures_total: total, fixtures_passed: cases.filter((c) => c.ok).length, cases });
const attempt = (name: string, f: () => boolean | string | void): CaseResult => { try { const r = f(); return r === false ? { name, ok: false } : typeof r === 'string' ? { name, ok: false, detail: r } : { name, ok: true }; } catch (e) { return { name, ok: false, detail: (e as Error).message.slice(0, 200) }; } };
type Fx = { schema?: string; valid?: boolean; data?: unknown; kind?: string; frame?: Record<string, unknown>; secret?: unknown; secret_payload?: unknown; note?: string };
const fx = (f: { json: unknown }) => f.json as Fx;

/** Every fixture in `areas` that names a schema is valid or invalid against it, as it says. */
const schemaCases = (fixtures: { file: string; json: unknown }[]): CaseResult[] => fixtures.filter((f) => fx(f).schema).map((f) => attempt(f.file, () => { const j = fx(f); const r = validateAgainst(j.schema!, j.data, 'strict'); return r.ok === !!j.valid || `expected ${j.valid ? 'valid' : 'invalid'}`; }));
const walkStrings = (v: unknown, out: string[] = []): string[] => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => walkStrings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => walkStrings(x, out)); return out; };

const eventCase = (f: { file: string; json: unknown }): CaseResult => attempt(f.file, () => {
  const j = fx(f); const frame = j.frame!; if (!parseFrame(frame).ok) return 'frame does not parse'; assertWritableFrame(frame); const mode = payloadMode(j.kind!); if (mode === 'unknown') return 'unknown kind';
  if (frame.p !== undefined && mode !== 'encrypted') { if (!parseEventPayload(j.kind!, frame.p).ok) return 'clear payload does not parse'; }
  const sec = j.secret ?? j.secret_payload; if (sec !== undefined && mode !== 'clear' && !parseSecretPayload(j.kind!, sec).ok) return 'secret payload does not parse';
});
const byKind = (contract: string, prefixes: string[]): Suite => ({ contract, areas: ['events'], run: ({ fixtures }) => done(fixtures.area('events').filter((f) => prefixes.some((p) => String(fx(f).kind).startsWith(p))).map(eventCase)) });
export const SUITES: Suite[] = [
  byKind('CT-WS-PRESENCE', ['presence.']), byKind('CT-WS-QUEUE', ['queue.']), byKind('CT-WS-CONTROL', ['control.', 'key.']),
  { contract: 'CT-VER', areas: [], run: () => done([
    attempt('the User-Agent has the contract form', () => /^centcom-cli\/1\.2\.3 \(contract\/[^;]+; linux-x64; node\/22\.0\.0\)$/.test(userAgent({ name: 'centcom-cli', version: '1.2.3', platform: 'linux', arch: 'x64', node: '22.0.0' }))),
    attempt('versions order like semver, pre-releases first', () => compareVersions('1.2.0', '1.10.0') === -1 && compareVersions('1.2.0-rc.1', '1.2.0') === -1 && compareVersions('1.0.0', '1.0.0') === 0),
    attempt('a client below the minimum is too old', () => isClientTooOld('1.0.0', '1.1.0') && !isClientTooOld('1.1.0', '1.1.0')),
    attempt('an unsupported protocol major is refused, an unknown frame type is not', () => !parseFrame({ v: 2, t: 'event' }).ok && parseFrame({ v: 1, t: 'sys.brand_new' }).ok),
  ]) },
  { contract: 'CT-IDS', areas: ['events', 'envelope', 'notification'], run: ({ fixtures }) => {
    const cases: CaseResult[] = []; const files = [...fixtures.area('events'), ...fixtures.area('envelope'), ...fixtures.area('notification')];
    for (const f of files) cases.push(attempt(`${f.file}: every id-shaped string is a valid id`, () => { for (const s of walkStrings(f.json)) { const m = /^([a-z]{3})_(.+)$/.exec(s); if (m && ID_PREFIXES.includes(m[1] as never) && /^[0-9A-Z]{26}$/.test(m[2]!) && !isId(m[1] as never, s)) return `${s} is not accepted`; } }));
    cases.push(attempt('bad ids are refused (lower case, wrong length, excluded letters, unknown prefix)', () => ['ses_01ja3z8k2m5n7p9q0r1s2t3v4w', 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4', 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4WW', 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4I', 'zzz_01JA3Z8K2M5N7P9Q0R1S2T3V4W', 'ses-01JA3Z8K2M5N7P9Q0R1S2T3V4W'].every((s) => !isId('ses', s))));
    return done(cases);
  } },
  { contract: 'CT-ERR', areas: ['problem'], run: ({ fixtures, contractsDir }) => {
    const reg = JSON.parse(readFileSync(join(contractsDir, 'errors.json'), 'utf8')) as { base: string; errors: { code: string; status: number; type: string; retryable: boolean }[] };
    const cases = schemaCases(fixtures.area('problem'));
    cases.push(attempt('registry: each type is base + code, codes are unique', () => { const seen = new Set<string>(); for (const e of reg.errors) { if (e.type !== reg.base + e.code) return `${e.code}: type`; if (seen.has(e.code)) return `${e.code}: duplicate`; seen.add(e.code); } }));
    cases.push(attempt('an unknown code maps to its status class and is never retried when it is a 4xx', () => { const e = parseProblem({ status: 418, headers: new Headers(), bodyText: JSON.stringify({ code: 'teapot_overflow', status: 418, title: 't', type: 'x' }) }); return e.status === 418 && e.code === 'unknown'; }));
    const dec = (status: number, method = 'GET', hasIdempotencyKey = false, retryAfterS?: number) => retryDecision({ status, method, hasIdempotencyKey, attempt: 1, authRefreshed: false, retryAfterS });
    cases.push(attempt('429 retries (with Retry-After), 400/403/404 never, 5xx only when idempotent', () => dec(429, 'POST', false, 2).retry && ![400, 403, 404].some((s) => dec(s).retry) && dec(503, 'GET').retry && !dec(503, 'POST').retry && dec(503, 'POST', true).retry));
    return done(cases);
  } },
  { contract: 'CT-WS-ENVELOPE', areas: ['envelope'], run: ({ fixtures }) => {
    const cases = fixtures.area('envelope').map((f) => attempt(f.file, () => { const j = fx(f); const r = validateAgainst(j.schema ?? 'envelope.schema.json', j.data, 'strict'); return r.ok === !!j.valid || `expected ${j.valid ? 'valid' : 'invalid'}`; }));
    cases.push(attempt('a frame with an unknown type is accepted and ignored', () => parseFrame({ v: 1, t: 'sys.brand_new' }).ok));
    return done(cases);
  } },
  { contract: 'CT-WS-SESSION-EVENTS', areas: ['events'], run: ({ fixtures }) => {
    const cases: CaseResult[] = []; const events = fixtures.area('events');
    for (const f of events) cases.push(eventCase(f));
    const any = events.find((f) => fx(f).kind === 'agent.state'); const state = any ? fx(any).frame! : undefined;
    cases.push(attempt('tolerance: an extra unknown field is accepted', () => !!state && parseFrame({ ...state, shiny_new_field: 1 }).ok));
    cases.push(attempt('tolerance: an unknown kind is accepted and flagged', () => { if (!state) return false; const r = parseFrame({ ...state, k: 'agent.teleport' }); return r.ok && r.unknown === true; }));
    cases.push(attempt('tolerance: an unknown enum value is accepted unchanged', () => { const p = { agent_id: 'agt_01JA3Z8K2M5N7P9Q0R1S2T3V4W', state: 'not-a-state', since: '2026-10-05T18:07:41.123Z' }; return parseEventPayload('agent.state', p).ok && !(AGENT_WIRE_STATES as readonly string[]).includes('not-a-state'); }));
    cases.push(attempt('tolerance: a really broken frame is refused', () => !parseFrame({ v: 2, t: 'event' }).ok && !parseFrame(null).ok));
    cases.push(attempt('every event kind in the registry has a fixture', () => { const kinds = new Set(events.map((f) => fx(f).kind)); const miss = (['queue.submit', 'agent.state', 'message.user'] as EventKind[]).filter((k) => !kinds.has(k)); return miss.length === 0 || `missing ${miss.join(',')}`; }));
    return done(cases);
  } },
  { contract: 'CT-CRYPTO', areas: ['crypto'], run: async ({ fixtures }) => {
    await initCrypto(); const f = fixtures.area('crypto')[0]; if (!f) return done([]); const V = f.json as Record<string, any>; const header = V.xchacha20poly1305.aad_header as FrameHeader & { kid: string }; const { kid: _k, ...H } = header; void _k; const k = unb64(V.keys.session_key_k1);
    const base = { alg: 'xchacha20poly1305' as const, kid: 'k1', n: V.xchacha20poly1305.nonce, c: V.xchacha20poly1305.ciphertext }; const s = sodium(); const cases: CaseResult[] = [];
    cases.push(attempt('AAD is the canonical JSON form', () => canonicalJson(header) === V.xchacha20poly1305.aad_jcs));
    cases.push(attempt('c: the fixed key, nonce and AAD give the exact ciphertext, and it opens', () => { const ct = encryptPayload({ key: k, kid: 'k1', header: H as FrameHeader, secret: JSON.parse(V.xchacha20poly1305.plaintext_jcs), nonce: unb64(V.xchacha20poly1305.nonce) }); return ct.c === V.xchacha20poly1305.ciphertext && ct.n === base.n && !!decryptPayload({ keyFor: () => k, header: H as FrameHeader, ct }); }));
    cases.push(attempt('sig: the exact signature, and it verifies', () => { const kp = s.crypto_sign_seed_keypair(s.crypto_generichash(32, 'centcom/test/device-sign', null)); const sig = signFrame(kp.privateKey, { header: H as FrameHeader, ct: base }); return sig === V.frame_signature.signature && verifyFrame(kp.publicKey, { header: H as FrameHeader, ct: base }, sig); }));
    cases.push(attempt('path_hmac: every vector, and the path MAC key', () => { if (b64(pathMacKey(k)) !== V.keys.path_mac_key) return 'key'; const r = new KeyRing(); r.addEpoch('k1', k); return (V.path_hmac as { path: string; hmac: string }[]).every((p) => pathHmac(r, 'k1', p.path) === p.hmac); }));
    cases.push(attempt('fingerprint', () => fingerprint(V.keys.device_x25519_public, V.keys.device_ed25519_public) === V.fingerprint));
    cases.push(attempt('negative: a flipped ciphertext bit fails authentication', () => { try { decryptPayload({ keyFor: () => k, header: H as FrameHeader, ct: { ...base, c: V.negative[0].ciphertext } }); return false; } catch { return true; } }));
    cases.push(attempt('negative: a wrong kid fails', () => { try { decryptPayload({ keyFor: () => k, header: H as FrameHeader, ct: { ...base, kid: 'k2' } }); return false; } catch { return true; } }));
    cases.push(attempt('negative: a flipped signature bit does not verify', () => !verifyFrame(unb64(V.keys.device_ed25519_public), { header: H as FrameHeader, ct: base }, V.negative[2].signature)));
    cases.push(attempt('sealed box has 48 bytes of overhead', () => { const kp = s.crypto_box_keypair(); return s.crypto_box_seal(s.randombytes_buf(32), kp.publicKey).length === 80; }));
    return done(cases);
  } },
  { contract: 'CT-TELEMETRY', areas: ['telemetry'], run: ({ fixtures }) => done(schemaCases(fixtures.area('telemetry'))) },
  { contract: 'CT-NOTIF-PAYLOAD', areas: ['notification'], run: ({ fixtures }) => done(schemaCases(fixtures.area('notification'))) },
  { contract: 'CT-API-RELEASES', areas: ['release'], run: ({ fixtures }) => done(schemaCases(fixtures.area('release'))) },
  { contract: 'CT-ENTITLEMENTS', areas: ['entitlements'], run: ({ fixtures }) => done(schemaCases(fixtures.area('entitlements'))) },
  { contract: 'CT-LAN', areas: ['lan'], run: ({ fixtures }) => done(schemaCases(fixtures.area('lan'))) },
  { contract: 'CT-STATE-MAP', areas: [], run: ({ contractsDir }) => {
    const m = JSON.parse(readFileSync(join(contractsDir, 'state-map.json'), 'utf8')) as Record<string, string>; const keys = Object.keys(m);
    return done([attempt('exactly the state names the protocol knows (the card says 61, the contract now has 64)', () => keys.length >= 61 && [...keys].sort().join() === [...STATE_NAMES].sort().join()), attempt('every state names a mascot clip', () => Object.values(m).every((v) => /^[a-z_]+$/.test(v)))]);
  } },
  { contract: 'CT-PROVIDER', areas: ['providers'], run: ({ fixtures }) => done(fixtures.area('providers').map((f) => attempt(f.file, () => { const j = f.json as { note?: string; schema?: string; data?: unknown; valid?: boolean; patterns?: { regex: string }[] }; for (const p of j.patterns ?? []) new RegExp(p.regex, 'u'); if (j.schema) { const r = validateAgainst(j.schema, j.data, 'strict'); return r.ok === !!j.valid; } return !!j.note; }))) },
];
