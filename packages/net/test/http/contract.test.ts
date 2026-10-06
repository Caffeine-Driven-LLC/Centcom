import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { OPERATIONS, validateAgainst } from '@centcom/protocol';
import { createRng, generateFromSchema, type MockBackend } from '@centcom/testkit';
import doc from '../../../protocol/src/generated/openapi.json' with { type: 'json' };
import { HTTP_OPERATIONS, checkShape, type HttpClient, type HttpOperationId, type HttpOperationSpec, type OperationArgs, type OperationResponse } from '../../src/index.js';
import { onMock } from './helpers.js';

type Doc = { paths: Record<string, Record<string, { operationId?: string; requestBody?: { content?: Record<string, { schema?: unknown }> } }>> };
const IDS = Object.keys(HTTP_OPERATIONS) as HttpOperationId[];
/** Contract schemas that @centcom/protocol (C003) validates directly. ReleaseManifest is left out: openapi.yaml names the field
 *  `min_supported_version` while schemas/release-manifest.schema.json requires `min_supported`, so the two contracts disagree. */
const C003: Record<string, string> = { Entitlements: 'entitlements' };
const PKG = join(__dirname, '../..');
const gen = (...a: string[]) => spawnSync(process.execPath, ['--import', 'tsx', join(PKG, 'scripts/gen-http.ts'), ...a], { cwd: PKG, encoding: 'utf8' });

describe('the generated operation table', () => {
  it('has every operation of openapi.yaml with the same method and path as @centcom/protocol', () => {
    expect(IDS.length).toBe(Object.keys(OPERATIONS).length); expect(IDS.length).toBe(93);
    for (const id of IDS) { const p = (OPERATIONS as Record<string, { method: string; path: string }>)[id]!; expect(HTTP_OPERATIONS[id].method, id).toBe(p.method); expect(HTTP_OPERATIONS[id].path, id).toBe(p.path); }
    expect(HTTP_OPERATIONS.ingestUsageEvents).toMatchObject({ idempotency: 'R', maxBodyBytes: 1024 * 1024, scopes: ['usage:write'] });
    expect(HTTP_OPERATIONS.createSession.idempotency).toBe('A'); expect(HTTP_OPERATIONS.revokeToken.idempotency).toBe('none'); expect(HTTP_OPERATIONS.listSessions.paginated).toBe(true);
    expect(HTTP_OPERATIONS.getStatus.auth).toBe('none'); expect(HTTP_OPERATIONS.getFlags.auth).toBe('optional'); expect(HTTP_OPERATIONS.getMe.auth).toBe('required');
  });
  it('types come from @centcom/protocol', () => {
    expectTypeOf<OperationArgs<'getSession'>['path']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<OperationResponse<'getStatus'>>().toHaveProperty('min_client_version');
    expectTypeOf<OperationResponse<'deleteMe'>>().not.toBeAny();
  });
  it('gen:http --check exits 0 on a clean tree and 1 after one operation changes in a copy of openapi.yaml', () => {
    const ok = gen('--check'); expect(ok.status, ok.stderr).toBe(0);
    const dir = mkdtempSync(join(tmpdir(), 'gen-http-')); const copy = join(dir, 'openapi.yaml');
    writeFileSync(copy, readFileSync(join(PKG, '../../contracts/openapi.yaml'), 'utf8').replace('operationId: revokeToken\n', 'operationId: revokeToken\n      x-idempotency-changed: true\n').replace(/(operationId: revokeToken[\s\S]*?x-idempotency: )none/, '$1accepted'));
    const bad = gen('--check', '--spec', copy); expect(bad.status).toBe(1); expect(bad.stderr).toContain('STALE');
    const out = join(dir, 'ops.ts'); expect(gen('--spec', copy, '--out', out).status).toBe(0); expect(readFileSync(out, 'utf8')).toMatch(/"revokeToken": \{[^\n]*"idempotency":"A"/);
  }, 60_000);
});

describe('every operation against the mock backend', () => {
  let m: MockBackend; let client: HttpClient; let refreshToken = '';
  beforeAll(async () => {
    const t = await onMock(); m = t.m; client = t.client;
    const dc = (await client.call('startDeviceAuthorization', { body: { client_id: 'centcom-cli', device_name: 'Test', device_pubkeys: { x25519: 'A'.repeat(43), ed25519: 'B'.repeat(43) } } as never })).data;
    await m.control('approve-device', { user_code: dc.user_code });
    const tok = await client.call('issueToken', { body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code, client_id: 'centcom-cli' } as never });
    refreshToken = tok.data.refresh_token ?? ''; t.setToken(tok.data.access_token);
  });
  afterAll(async () => { await m.stop(); });

  it('each one is callable and its answer passes the contract check (and the C003 validator where one exists)', async () => {
    const rng = createRng(3); const failures: string[] = []; let ok = 0;
    for (const id of IDS) {
      const spec: HttpOperationSpec = HTTP_OPERATIONS[id];
      const path = Object.fromEntries(spec.pathParams.map((k) => [k, k === 'id' && spec.path.startsWith('/v1/sessions') ? 'ses_01M48T58FY4TWS68231JFXTFFX' : k === 'id' && spec.path.startsWith('/v1/workspaces') ? 'wsp_01M48T58FY4TWS68231JFXTFFX' : k === 'channel' ? 'stable' : k === 'token' ? 'sh_token' : 'sample']));
      const query = Object.fromEntries(spec.requiredQuery.map((k) => [k, k === 'response_type' ? 'code' : k === 'code_challenge_method' ? 'S256' : 'x']));
      const op = Object.values((doc as Doc).paths[spec.path]!).find((o) => o?.operationId === id)!;
      const schema = op.requestBody?.content?.['application/json']?.schema;
      let body = schema ? generateFromSchema(schema as Record<string, unknown>, { doc: doc as Record<string, unknown>, rng, now: () => m.clock.now() }) : undefined;
      if (id === 'issueToken') body = { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'centcom-cli' };
      const args = { ...(spec.pathParams.length ? { path } : {}), ...(spec.requiredQuery.length ? { query } : {}), ...(body !== undefined ? { body } : {}) } as never;
      try {
        const r = await client.call(id, args);
        if (!spec.success.includes(r.status)) { failures.push(`${id}: status ${r.status}`); continue; }
        if (spec.response && r.status !== 204) { const p = checkShape(spec.response, r.data); if (p !== null) { failures.push(`${id}: ${p}`); continue; } }
        const c3 = spec.responseType ? C003[spec.responseType] : undefined;
        if (c3) { const v = validateAgainst(c3, r.data); if (!v.ok) { failures.push(`${id}: C003 ${JSON.stringify(v.issues)}`); continue; } }
        ok++;
      } catch (e) {
        failures.push(`${id}: ${(e as Error).name} ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]); expect(ok).toBe(93);
  }, 30_000);
  it('getStatus and getJwks return the documents, without acting on min_client_version', async () => {
    const s = await client.getStatus(); expect(typeof s.contract_version).toBe('string'); expect(s).toHaveProperty('min_client_version');
    const j = await client.getJwks(); expect(j.keys.length).toBeGreaterThan(0); expect(j.keys[0]).toHaveProperty('kid');
  });
});

describe('tolerant reading (CT-VER)', () => {
  it('unknown fields and unknown enum values pass; wrong types and missing required fields do not', () => {
    const spec = HTTP_OPERATIONS.getStatus.response;
    const base = { status: 'operational', updated_at: '2026-10-06T12:00:00.000Z', components: [{ id: 'relay-eu', name: 'Relay', status: 'brand_new_state', extra: 1 }], incidents: [], min_client_version: '1.0.0', contract_version: '1.2.0', added_later: { x: 1 } };
    expect(checkShape(spec, base)).toBeNull();
    expect(checkShape(spec, { ...base, components: [{ id: 'x', name: 'y' }] })).toBe('/components/0/status');
    expect(checkShape(spec, { ...base, components: 'nope' })).toBe('/components');
    expect(checkShape(HTTP_OPERATIONS.getFlags.response, { flags: { 'a/b~c': [1] }, rev: 1, ttl_s: 1 })).toBe('/flags/a~1b~0c');
  });
});
