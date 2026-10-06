import { describe, expect, it } from 'vitest';
import { startMockBackend } from '@centcom/testkit';
import { AGENT, report, rig } from './rig.js';

/** The mock backend validates request bodies against the OpenAPI schema (CT-API-USAGE), so a batch it accepts has the right shape. */
describe('usage batches match CT-API-USAGE', () => {
  it('every batch is accepted by POST /v1/usage/events and stays under 1 MiB', async () => {
    const m = await startMockBackend({ clock: 'virtual', seed: 7 });
    try {
      const j = async (path: string, body: unknown, h: Record<string, string> = {}) => { const r = await fetch(m.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => undefined) as any }; };
      const dc = (await j('/v1/auth/device/code', { client_id: 'centcom-cli', device_name: 'Test', device_pubkeys: { x25519: 'A'.repeat(43), ed25519: 'B'.repeat(43) } })).body; await m.control('approve-device', { user_code: dc.user_code });
      const tok = (await j('/v1/auth/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: dc.device_code, client_id: 'centcom-cli' })).body.access_token as string;
      const { ledger, advance, at } = rig(); for (let i = 0; i < 700; i++) ledger.onUsageReport(report({ tokensIn: i + 1, tokensOut: 3 })); ledger.onAgentState(AGENT, 'thinking', at()); advance(300_000); ledger.onAgentState(AGENT, 'idle', at());
      let b; let n = 0; while ((b = ledger.dequeueBatch()).length) { const body = { events: b }; expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(1 << 20); const r = await j('/v1/usage/events', body, { authorization: `Bearer ${tok}`, 'idempotency-key': `k-${n++}` }); expect(r.status, JSON.stringify(r.body)).toBeLessThan(300); }
      expect(n).toBe(3);
    } finally { await m.stop(); }
  });
});
