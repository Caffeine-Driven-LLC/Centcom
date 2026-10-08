import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { AppController } from '../src/controller.js';
import { errorGuide } from '../src/errors.js';

const CODES = ['provider_not_installed', 'provider_not_signed_in', 'provider_method_disabled', 'provider_policy_blocked', 'provider_cap_reached', 'provider_rate_limited', 'provider_version_unsupported', 'provider_protocol_error', 'provider_capability_missing', 'something_else'];
describe('error guidance', () => {
  it.each(CODES)('%s says what happened and what to do, in plain words', (code) => {
    const g = errorGuide(code, 'Claude Code'); expect(g.title.length).toBeGreaterThan(8); expect(g.help.length).toBeGreaterThan(30); expect(g.help).toMatch(/[.]$/); expect(g.title + g.help).not.toMatch(/provider_|undefined|\[object/);
  });
  it('names the engine and its own sign-in and install steps', () => {
    expect(errorGuide('provider_not_signed_in', 'Codex').help).toContain('codex login'); expect(errorGuide('provider_not_signed_in', 'Claude Code').help).toContain('`claude`');
    expect(errorGuide('provider_not_installed', 'Codex').help).toContain('github.com/openai/codex'); expect(errorGuide('provider_not_installed', 'Claude Code').title).toBe('Claude Code is not installed');
    expect(errorGuide('provider_not_signed_in', 'Some Agent').help).toContain('Some Agent');
  });
  it('shows up in the transcript with the engine\'s own details underneath', () => {
    const c = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', version: 't', skills: [] });
    c.apply({ v: 1, seq: 1, ts: new Date().toISOString(), agent_id: c.state.activeAgent, type: 'error', code: 'provider_cap_reached', tool_message: 'resets at 5pm', fatal: false });
    const n = c.state.items.filter((i) => i.kind === 'notice').at(-1) as { text: string; detail?: string; level: string };
    expect(n.level).toBe('error'); expect(n.text).toBe('Usage limit reached'); expect(n.detail).toContain('/model'); expect(n.detail).toContain('Details: resets at 5pm');
  });
});
