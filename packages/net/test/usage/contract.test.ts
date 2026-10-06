import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { bodyOf, ev, ok, scriptedReporter } from './helpers.js';

const doc = JSON.parse(readFileSync(new URL('../../../protocol/src/generated/openapi.json', import.meta.url), 'utf8')) as { components: { schemas: Record<string, unknown> } };
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true }); ajv.addSchema({ $id: 'oa', components: doc.components });
const validate = ajv.compile({ $ref: 'oa#/components/schemas/UsageBatch' });
describe('batches match CT-API-USAGE', () => {
  it('every batch validates against the request schema and stays under 1 MiB, with 1 to 500 events', async () => {
    const r = scriptedReporter(Array.from({ length: 4 }, () => () => ok(500)), { maxBatch: 500 }); r.r.start(); for (let i = 0; i < 1250; i++) r.r.record(ev(i + 1, { type: ['tokens_in', 'tokens_out', 'agent_minutes'][i % 3] })); await r.r.flush();
    expect(r.posts().length).toBeGreaterThanOrEqual(3); for (const p of r.posts()) { const b = bodyOf(p); expect(validate(b), JSON.stringify(validate.errors)).toBe(true); expect(Buffer.byteLength(p.body!)).toBeLessThan(1 << 20); expect(b.events.length).toBeGreaterThanOrEqual(1); expect(b.events.length).toBeLessThanOrEqual(500); expect(p.headers['idempotency-key']).toMatch(/\S+/); } await r.r.stop();
  });
  it('the schema really rejects a bad batch (so the test above means something)', () => { expect(validate({ events: [] })).toBe(false); expect(validate({ events: [{ id: 'x', type: 'tokens_in', qty: 1, at: 'now' }] })).toBe(false); expect(validate({ events: [{ id: 'use_01JA3Z8K2M5N7P9Q0R1S2T3V4W', type: 'tokens_in', qty: 1.5, at: '2026-10-06T12:00:00Z' }] })).toBe(false); });
});
