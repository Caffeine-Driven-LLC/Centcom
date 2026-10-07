import { describe, expect, it } from 'vitest';
import { fromSessionHandle, requestHandoff } from '../../src/handoff/index.js';
import { clock } from './fake.js';

type Ev = { kind: string; seq: number; from: string; p?: Record<string, unknown> };
function handle(roster: { id: string; role: string; device?: string }[], held: string[]) {
  const fns: ((e: Ev) => void)[] = []; const log: Ev[] = []; const sent: string[] = [];
  const h = { me: { id: 'host1', role: 'host' }, roster: () => roster, heldEpochs: () => held, sendEvent: async (k: string) => { sent.push(k); return { id: 'x', seq: 1 }; }, onAny: (fn: (e: Ev) => void, o?: { replay?: boolean }) => { if (o?.replay) log.forEach(fn); fns.push(fn); return () => undefined; } };
  return { h: h as never, emit: (e: Ev) => { log.push(e); fns.forEach((f) => f(e)); }, sent };
}
const grant = (seq: number, device: string, kids: string[]): Ev => ({ kind: 'key.grant', seq, from: 'host1', p: { to_device: device, kids } });
describe('keys before a transfer (the guardrail)', () => {
  it('an editor is missing keys until a grant names every epoch the host holds; earlier grants count (replay)', async () => {
    const r = handle([{ id: 'host1', role: 'host', device: 'd0' }, { id: 'ed1', role: 'editor', device: 'd1' }, { id: 'ed2', role: 'editor', device: 'd2' }, { id: 'ed3', role: 'editor' }], ['k1', 'k2']); r.emit(grant(1, 'd1', ['k1'])); const s = fromSessionHandle(r.h, clock());
    const miss = () => Object.fromEntries(s.members().map((m) => [m.id, m.missingKeys])); expect(miss()).toEqual({ host1: undefined, ed1: true, ed2: true, ed3: true });
    r.emit(grant(2, 'd1', ['k2'])); r.emit(grant(3, 'd2', ['k1', 'k2'])); expect(miss()).toMatchObject({ ed1: false, ed2: false, ed3: true });
    expect(await requestHandoff(s, 'ed3')).toEqual({ ok: false, code: 'keys_missing' }); expect(r.sent).toEqual([]);
  });
});
