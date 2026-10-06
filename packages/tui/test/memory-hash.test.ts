import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { AppController } from '../src/controller.js';

function rig(onMemoryAdd?: ConstructorParameters<typeof AppController>[0]['onMemoryAdd']) {
  const engine = new DemoEngine({ speed: 100 }); const sends: string[] = []; const start = engine.start.bind(engine);
  engine.start = async (o) => { const s = await start(o); const send = s.send.bind(s); s.send = async (p: string) => { sends.push(p); return send(p); }; return s; };
  const c = new AppController({ engine, demo: true, cwd: '/tmp', version: 't', skills: [], onMemoryAdd }); return { c, sends };
}
const notices = (c: AppController) => c.state.items.filter((i) => i.kind === 'notice') as { kind: 'notice'; level: string; text: string; detail?: string }[];

describe('# lines are memory notes', () => {
  it('`# remember tabs` makes a quick-add plan, shows the diff, is not sent to the engine, and is not kept as a prompt', async () => {
    const asked: string[] = []; const { c, sends } = rig(async (t) => { asked.push(t); return { diff: '+- remember tabs', apply: async () => 'Added to memory.' }; }); await c.start();
    await c.submit('# remember tabs'); expect(asked).toEqual(['remember tabs']); expect(sends).toEqual([]); expect(c.state.items.some((i) => i.kind === 'user')).toBe(false); expect(c.state.history).not.toContain('# remember tabs'); expect(notices(c).at(-1)).toMatchObject({ level: 'info', detail: '+- remember tabs' });
  });
  it('"y" applies it (and goes nowhere else); anything else cancels', async () => {
    let applied = 0; const mk = async () => ({ diff: 'd', apply: async () => { applied++; return 'Added to memory.'; } }); const a = rig(mk); await a.c.start(); await a.c.submit('# one note'); await a.c.submit('y'); expect(applied).toBe(1); expect(notices(a.c).at(-1)).toMatchObject({ level: 'ok', text: 'Added to memory.' }); expect(a.sends).toEqual([]);
    const b = rig(mk); await b.c.start(); await b.c.submit('# another'); await b.c.submit('nope'); expect(applied).toBe(1); expect(notices(b.c).at(-1)!.text).toBe('Nothing was added to memory.'); expect(b.sends).toEqual([]); await b.c.submit('y'); expect(applied).toBe(1); // a later "y" is an ordinary prompt, not a confirmation
  });
  it('`#hashtag` (no space) is an ordinary prompt', async () => { const { c, sends } = rig(async () => ({ error: 'should not be called' })); await c.start(); await c.submit('#hashtag is a prompt'); await new Promise((r) => setTimeout(r, 20)); expect(sends).toEqual(['#hashtag is a prompt']); });
  it('a refused note (secret, too long) shows the reason and nothing is pending', async () => { const { c, sends } = rig(async () => ({ error: 'That text looks like a password or key, so it was not saved.' })); await c.start(); await c.submit('# my key is sk-ant-xxx'); expect(notices(c).at(-1)).toMatchObject({ level: 'warn' }); await c.submit('y'); expect(sends.length).toBeLessThanOrEqual(1); expect(notices(c).filter((n) => n.level === 'ok')).toEqual([]); });
  it('without a memory hook a `# ` line is just a prompt', async () => { const { c, sends } = rig(); await c.start(); await c.submit('# not a note here'); await new Promise((r) => setTimeout(r, 20)); expect(sends).toEqual(['# not a note here']); });
});
