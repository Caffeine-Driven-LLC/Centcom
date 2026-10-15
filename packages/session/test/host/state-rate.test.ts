import { afterEach, describe, expect, it } from 'vitest';
import { ReconnectTokens } from '@centcom/lan';
import { initCrypto } from '@centcom/net';
import { HostSessionEngine, createFilePersistence } from '../../src/index.js';
import { lanServer, mem } from '../rigs.js';
import { join } from 'node:path';

const stops: (() => Promise<void>)[] = []; afterEach(async () => { for (const s of stops.splice(0).reverse()) await s().catch(() => undefined); });
const agt = (n: number) => `agt_${String(n).padStart(26, '0')}`;
async function engineAt() {
  await initCrypto(); const env = await lanServer(); let now = 1_000_000; const clock = { now: () => now, setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (h: never) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>) };
  const engine = new HostSessionEngine({ server: env.server, persistence: createFilePersistence(join(env.dir, 'h')), tokens: new ReconnectTokens(), clock, mode: 'branch' }); await engine.start(); stops.push(() => engine.stop());
  const state = (member: number, agent: string) => engine.onInbound({ from: { id: mem(member), name: 'm', slot: member, role: 'editor' } as never, frame: { t: 'event', k: 'agent.state', id: 'x', sid: 's', p: { agent_id: agent, state: 'idle', since: new Date(now).toISOString() } } as never });
  return { engine, state, advance: (ms: number) => { now += ms; } };
}

describe('the host engine limits agent.state frames per member and agent', () => {
  it('a member cannot use up another member\'s allowance by naming the same agent id', async () => {
    const { state } = await engineAt(); const same = agt(7);
    expect(state(2, same)).toBe('accept'); expect(state(2, same)).toBe('accept'); expect(state(2, same)).toMatchObject({ reject: { code: 'rate_limited' } }); // the sender's own third frame in a second is limited
    expect(state(3, same)).toBe('accept'); // somebody else's frames for the same id are not
  });
  it('the table of senders and agents stays small: expired entries go, and it has a hard cap', async () => {
    const { engine, state, advance } = await engineAt();
    for (let i = 0; i < 2000; i++) state(2, agt(i)); expect(engine.stateRateKeys()).toBeLessThanOrEqual(1024); // all within one second: the cap holds
    advance(2000); state(2, agt(9999)); expect(engine.stateRateKeys()).toBeLessThanOrEqual(257); // a second later the old ones are swept as soon as the table is large
  });
});
