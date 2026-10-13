import { describe, expect, it } from 'vitest';
import { createProviderDetector, type ProviderStatus, type RunFn } from '@centcom/agent';
import { providerPreflight } from '../src/preflight.js';

const status = (o: Partial<ProviderStatus> = {}): ProviderStatus => ({ engine: 'claude-code', provider: 'anthropic', installed: true, path: '/usr/bin/claude', version: '2.1.289', supported: 'yes', supported_range: '>=2.1 <3', signed_in: 'yes', login_kind: 'subscription', effective_kind: 'subscription', checked_at: '2026-10-14T00:00:00Z', errors: [], ...o });
const run = (s: ProviderStatus) => { const notes: { level: string; text: string; detail?: string }[] = []; return providerPreflight('claude-code', { detector: { detect: async () => s }, notice: (level, text, detail) => notes.push({ level, text, detail }) }).then((r) => ({ ...r, notes })); };

describe('provider preflight at start (lane C104)', () => {
  it('says nothing when the tool is installed, signed in and in range', async () => { const r = await run(status()); expect(r.notes).toEqual([]); expect(r.said).toEqual([]); });
  it('says nothing when the tool is not installed (choosing the engine already told the person)', async () => { expect((await run(status({ installed: false, signed_in: 'unknown' }))).notes).toEqual([]); });
  it('says nothing when it could not find out (unknown sign-in, a timed-out probe)', async () => { expect((await run(status({ signed_in: 'unknown', supported: 'unknown', errors: ['provider_protocol_error'] }))).notes).toEqual([]); });
  it('a tool that is not signed in becomes one warning with the next step, before any message fails', async () => {
    const r = await run(status({ signed_in: 'no', errors: ['provider_not_signed_in'] })); expect(r.notes).toHaveLength(1); expect(r.notes[0]).toMatchObject({ level: 'warn', text: 'Claude Code is not signed in' }); expect(r.notes[0]!.detail).toContain('centcom provider login claude');
  });
  it('a version outside the checked range says which version and which range', async () => {
    const r = await run(status({ version: '1.0.3', supported: 'below', errors: ['provider_version_unsupported'] })); expect(r.said).toEqual(['provider_version_unsupported']); expect(r.notes[0]!.detail).toContain('version 1.0.3'); expect(r.notes[0]!.detail).toContain('>=2.1 <3');
  });
  it('a detector that throws never throws out of the preflight', async () => { const notes: unknown[] = []; const r = await providerPreflight('codex', { detector: { detect: async () => { throw new Error('boom'); } }, notice: (...a) => notes.push(a) }); expect(r.said).toEqual([]); expect(notes).toEqual([]); });
  it('with the real detector and a scripted tool: old version and logged-out are found by probing it', async () => {
    const probe: RunFn = async (_f, args) => (args[0] === '--version' ? { code: 0, out: 'claude 0.9.0', missing: false, timedOut: false, tooLong: false } : args[0] === 'auth' && args[1] === '--help' ? { code: 0, out: 'usage', missing: false, timedOut: false, tooLong: false } : { code: 1, out: '{"loggedIn":false,"authMethod":"none"}', missing: false, timedOut: false, tooLong: false });
    const detector = createProviderDetector({ run: probe, which: () => '/x/claude', clock: { now: () => 0, setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h) } as never });
    const notes: string[] = []; const r = await providerPreflight('claude-code', { detector, notice: (_l, t) => notes.push(t) }); expect(r.said.sort()).toEqual(['provider_not_signed_in', 'provider_version_unsupported']); expect(notes).toHaveLength(2);
  });
});
