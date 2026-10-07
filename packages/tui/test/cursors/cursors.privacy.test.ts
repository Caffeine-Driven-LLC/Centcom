import { describe, expect, it } from 'vitest';
import { PresenceClient } from '@centcom/net';
import { createCursorPublisher } from '../../src/cursors/index.js';
import { clock } from './helpers.js';

describe('privacy (guardrail)', () => {
  it('the path and the lines travel only in the secret payload; the clear p stays empty', () => {
    const c = clock(); const sent: { kind: string; body: Record<string, unknown> }[] = []; const s = { me: { id: 'me' }, roster: () => [], onAny: () => () => undefined, sendEvent: async (kind: string, body: Record<string, unknown>) => { sent.push({ kind, body }); return { id: 'x', seq: 0 }; } };
    const pc = new PresenceClient(s as never, { clock: c, activity: { lastInputAt: () => 0, onInput: () => () => undefined } }); const pub = createCursorPublisher(pc, { clock: c }); pub.publish({ path: 'secret/CANARY-91.ts', line: 7, col: 2, selEndLine: 9, selEndCol: 1 }); c.advance(150);
    const f = sent.find((x) => x.kind === 'presence.cursor')!; expect(f).toBeDefined(); expect(f.body.p).toBeUndefined(); expect(f.body.secret).toMatchObject({ path: 'secret/CANARY-91.ts', line: 7 }); expect(JSON.stringify({ ...f.body, secret: undefined })).not.toContain('CANARY'); pub.dispose(); pc.dispose();
  });
});
