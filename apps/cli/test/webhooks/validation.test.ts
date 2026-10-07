import { describe, expect, it } from 'vitest';
import { checkEvents, checkUrl } from '../../src/commands/webhooks/validation.js';
import { WEBHOOK_EVENTS, runWebhooks } from '../../src/commands/webhooks/index.js';
import { json, rig, webhook } from './helpers.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('url validation (acceptance 2)', () => {
  it.each([['https://example.com/h', true], ['https://example.com:8443/a?b=1', true], ['http://example.com', false], ['ftp://example.com', false], ['javascript:alert(1)', false], ['example.com', false], ['https://u:p@example.com/', false], ['', false], ['http://localhost:3000/h', false], ['http://127.0.0.1/h', false]])('%s -> %s', (u, ok) => { expect(checkUrl(u).ok).toBe(ok); });
  it('http localhost passes only with the explicit flag, and http to any other host never does', () => { expect(checkUrl('http://localhost:3000/h', { allowLocalhost: true }).ok).toBe(true); expect(checkUrl('http://127.0.0.1/h', { allowLocalhost: true }).ok).toBe(true); expect(checkUrl('http://localhost.evil.com/h', { allowLocalhost: true }).ok).toBe(false); expect(checkUrl('http://example.com', { allowLocalhost: true }).ok).toBe(false); });
  it('a bad address is refused before any request', async () => { const r = rig([() => json(webhook())]); expect(await runWebhooks(['create', '--url', 'http://example.com', '--event', 'session.created'], r.deps)).toBe(1); expect(r.seen).toHaveLength(0); expect(r.err[0]).toContain('https://'); });
});
describe('event validation (acceptance 3)', () => {
  it('the list is exactly the contract enum, every type is accepted, unknown ones are refused with the valid list', () => {
    const spec = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../packages/protocol/src/generated/openapi.json'), 'utf8')).components.schemas.WebhookEventType.enum as string[]; expect([...WEBHOOK_EVENTS]).toEqual(spec);
    for (const e of WEBHOOK_EVENTS) expect(checkEvents([e])).toEqual({ ok: true, value: [e] }); const bad = checkEvents(['foo.bar', 'session.created']); expect(bad.ok).toBe(false); if (!bad.ok) { expect(bad.message).toContain('foo.bar'); expect(bad.message).toContain('session.created'); }
    expect(checkEvents([]).ok).toBe(false); expect(checkEvents(['session.created', 'session.created'])).toEqual({ ok: true, value: ['session.created'] }); expect(checkEvents(['Session.Created']).ok).toBe(false); expect(checkEvents(['webhook.test']).ok).toBe(false);
  });
  it('an unknown event is refused locally with exit 1 and no request', async () => { const r = rig([() => json(webhook())]); expect(await runWebhooks(['create', '--url', 'https://example.com/h', '--event', 'foo.bar'], r.deps)).toBe(1); expect(r.seen).toHaveLength(0); expect(r.err[0]).toContain('Valid types'); });
});
