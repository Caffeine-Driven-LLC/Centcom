import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultUserAgent } from '@centcom/net';
import { bridge, isLoopback } from '../../src/session/engine.js';
import { TailFeed } from '../../src/session/feed.js';
import { HOST, ME } from './helpers.js';

afterEach(() => { vi.useRealTimers(); });
const f = (seq: number) => ({ seq });
describe('putting the frames of a session in order for someone who joined in the middle (found by running the web engine against the backend)', () => {
  it('starts at the first frame it has instead of waiting for frame 1 forever; a repeat or an old frame changes nothing', () => {
    const got: number[] = []; const feed = new TailFeed<{ seq?: number }>((fs) => got.push(...fs.map((x) => x.seq!))); feed.push(f(41)); feed.push(f(43)); feed.push(f(42)); expect(got).toEqual([]); feed.release(); expect(got).toEqual([41, 42, 43]);
    feed.push(f(42)); feed.push(f(10)); feed.push(f(44)); expect(got).toEqual([41, 42, 43, 44]);
  });
  it('a frame this person is never sent leaves a gap that is passed after the wait, and the later frames follow in order', () => {
    vi.useFakeTimers(); const got: number[] = []; const feed = new TailFeed<{ seq?: number }>((fs) => got.push(...fs.map((x) => x.seq!)), { gapMs: 800 }); feed.release(); feed.push(f(5)); feed.push(f(6)); expect(got).toEqual([5, 6]);
    feed.push(f(9)); feed.push(f(8)); expect(got).toEqual([5, 6]); expect(feed.waiting).toBe(2); vi.advanceTimersByTime(799); expect(got).toEqual([5, 6]); vi.advanceTimersByTime(2); expect(got).toEqual([5, 6, 8, 9]); expect(feed.waiting).toBe(0); feed.stop();
  });
  it('frames without a sequence number are not part of the transcript', () => { const got: number[] = []; const feed = new TailFeed<{ seq?: number }>((fs) => got.push(...fs.map((x) => x.seq!))); feed.release(); feed.push({}); feed.push({ seq: 1.5 }); feed.push({ seq: 0 }); feed.push(f(1)); expect(got).toEqual([1]); });
});

describe('the bridge between the session client and the page (same run)', () => {
  const handle = (o: { state?: string; roster?: unknown[]; history?: () => Promise<number> } = {}) => {
    const any: ((e: unknown) => void)[] = []; const on: Record<string, ((a?: unknown) => void)[]> = {}; let roster = o.roster ?? [];
    return { h: { id: 's', state: o.state ?? 'connecting', me: { id: ME, slot: 1, role: 'viewer' }, roster: () => roster, history: { fetch: o.history ?? (async () => 0) }, onAny: (fn: (e: unknown) => void) => { any.push(fn); return () => undefined; }, on: (n: string, fn: (a?: unknown) => void) => { (on[n] ??= []).push(fn); return () => undefined; }, sendEvent: async () => ({ id: 'x', seq: 1 }) },
      emit: (e: unknown) => any.forEach((fn) => fn(e)), fire: (n: string, a?: unknown) => (on[n] ?? []).forEach((fn) => fn(a)), setRoster: (r: unknown[]) => { roster = r; } };
  };
  const ev = (seq: number, text: string) => ({ kind: 'message.user', seq, id: `msg_${seq}`, from: HOST, ts: 't', secret: { text }, verified: true });
  it('a client that is already live shows as live at once, and the people come from the client\'s roster (names, slots, roles, host)', () => {
    const w = handle({ state: 'live', roster: [{ id: HOST, name: 'Hana', slot: 0, role: 'host', online: true }, { id: ME, name: 'Maya', slot: 1, role: 'viewer', online: true }] }); const c = bridge(w.h as never);
    expect(c.state().phase).toBe('live'); expect(c.state().roster.map((m) => `${m.name}:${m.role}`)).toEqual(['Hana:host', 'Maya:viewer']); expect(c.state().hostId).toBe(HOST);
    w.setRoster([...w.h.roster(), { id: 'mem_new', name: 'Ben', slot: 2, role: 'editor', online: false }]); w.fire('roster'); expect(c.state().roster.find((m) => m.name === 'Ben')).toMatchObject({ connected: false }); c.close();
  });
  it('a client that is waiting for the host\'s key shows the waiting screen from the start, not "connecting"', () => { const w = handle({ state: 'waiting_for_key' }); const c = bridge(w.h as never); expect(c.state().phase).toBe('waiting_for_key'); c.close(); });
  it('history is read first, then the view starts at the first frame it has: someone who joins at frame 40 sees the transcript', async () => {
    vi.useFakeTimers(); const w = handle({ history: async () => { w.emit(ev(40, 'before you came')); return 1; } }); const c = bridge(w.h as never); w.emit(ev(41, 'live')); expect(c.state().transcript).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400); expect(c.state().transcript.map((e) => (e.kind === 'user' ? e.text : ''))).toEqual(['before you came', 'live']); w.emit(ev(42, 'later')); expect(c.state().transcript).toHaveLength(3); c.close();
  });
  it('a history that never answers does not hold the page back', async () => { vi.useFakeTimers(); const w = handle({ history: () => new Promise(() => undefined) }); const c = bridge(w.h as never); w.emit(ev(7, 'hello')); await vi.advanceTimersByTimeAsync(2000); expect(c.state().transcript).toHaveLength(1); c.close(); });
});

describe('the engine\'s setup', () => {
  it('uses a User-Agent the API client accepts (it threw on `centcom-web/0`, so no session page could open)', () => { const ua = defaultUserAgent('0.1.0', 'centcom-web'); expect(ua).toMatch(/^centcom-web\/0\.1\.0 \(contract\/\d+\.\d+\.\d+; [a-z0-9]+-[a-z0-9_]+; node\/[0-9A-Za-z.+-]+\)$/); });
  it('plain ws:// is only for a backend on this computer', () => { expect(isLoopback('http://localhost:3000')).toBe(true); expect(isLoopback('http://127.0.0.1:3000')).toBe(true); expect(isLoopback('https://api.centcom.dev')).toBe(false); expect(isLoopback('nonsense')).toBe(false); });
});
