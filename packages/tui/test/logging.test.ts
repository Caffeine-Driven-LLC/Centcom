import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { createLogger, createRingSink } from '@centcom/net';
import { AppController } from '../src/controller.js';

describe('what the app writes to its log', () => {
  it('records what happened (events, outcomes, approvals) but never what you said or did', async () => {
    const ring = createRingSink(); const logger = createLogger({ level: 'debug', sinks: [ring], clock: () => 0, home: '/home/alex' });
    const c = new AppController({ engine: new DemoEngine({ speed: 300 }), demo: true, cwd: '/home/alex/secret-project', branch: 'feat/private-thing', version: 't', skills: [], logger });
    await c.start(); c.setMode('bypassPermissions'); await c.submit('fix the failing test in the auth module'); for (let i = 0; i < 400 && c.state.busy; i++) await new Promise((r) => setTimeout(r, 25)); c.stop();
    const all = JSON.stringify(ring.snapshot()); const msgs = ring.snapshot().map((r) => r.msg);
    expect(msgs).toContain('engine.session_started'); expect(msgs).toContain('turn.done'); expect(msgs).toContain('permission_mode.changed'); expect(msgs).toContain('tool.requested');
    for (const secret of ['failing test', 'auth module', 'session.ts', 'secret-project', 'private-thing', 'pnpm test', 'isExpired', '/home/alex']) expect(all, secret).not.toContain(secret);
  });
});
