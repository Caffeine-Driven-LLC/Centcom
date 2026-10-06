import { describe, expect, it } from 'vitest';
import { AGENT, report, rig } from './rig.js';

const fill = (l: ReturnType<typeof rig>['ledger'], n: number) => { for (let i = 0; i < n; i++) l.onUsageReport(report({ tokensIn: i + 1 })); };
describe('usage outbox', () => {
  it('batches of at most 500, unique use_ ids', () => {
    const { ledger } = rig(); fill(ledger, 1200); const ids = new Set<string>(); let b; const sizes: number[] = [];
    while ((b = ledger.dequeueBatch(10_000)).length) { sizes.push(b.length); for (const e of b) { expect(e.id).toMatch(/^use_[0-9A-HJKMNP-TV-Z]{26}$/); ids.add(e.id); } }
    expect(sizes).toEqual([500, 500, 200]); expect(ids.size).toBe(1200);
  });
  it('survives a restart: 1,000 queued events come back in order, without duplicates', async () => {
    const a = rig(); fill(a.ledger, 1000); await a.ledger.flush(); const before = a.ledger.dequeueBatch(500).map((e) => e.id);
    const b = rig({ files: a.files }); await b.ledger.ready(); const got = [...b.ledger.dequeueBatch(), ...b.ledger.dequeueBatch()].map((e) => e.id); expect(got).toHaveLength(1000); expect(new Set(got).size).toBe(1000); expect(got.slice(0, 500)).toEqual(before);
  });
  it('a crash before the ack sends the batch again; after the ack it is gone; requeue puts it back in front', async () => {
    const a = rig(); fill(a.ledger, 3); const first = a.ledger.dequeueBatch(2); await a.ledger.flush();
    const b = rig({ files: a.files }); await b.ledger.ready(); expect(b.ledger.pending()).toBe(3);
    await a.ledger.ack(first.map((e) => e.id)); const c = rig({ files: a.files }); await c.ledger.ready(); expect(c.ledger.pending()).toBe(1);
    const x = c.ledger.dequeueBatch(); c.ledger.requeue(x.map((e) => e.id)); expect(c.ledger.dequeueBatch().map((e) => e.id)).toEqual(x.map((e) => e.id));
  });
  it('a damaged file keeps its good lines', async () => {
    const files = new Map([['/data/usage/outbox.jsonl', '{"id":"use_01JTEST0000000000000000001","type":"tokens_in","qty":3,"at":"2026-10-06T12:00:00.000Z"}\n{broken\n{"id":"use_01JTEST0000000000000000001","type":"tokens_in","qty":3,"at":"x"}\n{"id":"use_01JTEST0000000000000000002","type":"bogus","qty":1,"at":"x"}\n']]);
    const r = rig({ files }); await r.ledger.ready(); expect(r.ledger.pending()).toBe(1);
  });
  it('at 10,000 pending the oldest token events go first, agent minutes last, and dropped counts them', () => {
    const { ledger, advance, at } = rig(); ledger.onAgentState(AGENT, 'thinking', at()); advance(120_000); ledger.onAgentState(AGENT, 'idle', at()); fill(ledger, 10_000);
    expect(ledger.pending()).toBe(10_000); expect(ledger.snapshot({}).dropped).toBe(1); const all: string[] = []; let b; while ((b = ledger.dequeueBatch()).length) all.push(...b.map((e) => e.type)); expect(all[0]).toBe('agent_minutes');
  });
  it('usage events carry no text, paths, model names or engine ids', () => {
    const { ledger } = rig(); ledger.onUsageReport(report({ tokensIn: 5, tokensOut: 2, model: 'claude-secret-model', engineSessionId: '/home/me/project', agentId: 'not an id' }));
    for (const e of ledger.dequeueBatch()) { expect(Object.keys(e).sort()).toEqual(['at', 'id', 'qty', 'session_id', 'type']); expect(JSON.stringify(e)).not.toMatch(/claude|home|project|codex/); }
  });
});

describe('local only', () => {
  it('the ledger never touches the network: no network module or fetch anywhere in it', async () => {
    const { readdirSync, readFileSync } = await import('node:fs'); const dir = new URL('../../src/accounting/', import.meta.url);
    for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(/node:(net|http|https|dgram|tls)|\bfetch\(|WebSocket/);
  });
});
