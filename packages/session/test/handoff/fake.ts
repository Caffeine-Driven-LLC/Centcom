import type { HandoffFrame, HandoffSession, MemberLite, HandoffRole as Role } from '../../src/handoff/index.js';
export const clock = () => { let t = 0; const q: { at: number; fn: () => void; h: number }[] = []; let id = 0; return { now: () => t, setTimeout: (fn: () => void, ms: number) => { const h = ++id; q.push({ at: t + ms, fn, h }); return h; }, clearTimeout: (h: never) => { const i = q.findIndex((x) => x.h === (h as unknown as number)); if (i >= 0) q.splice(i, 1); }, advance(ms: number) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const n = q[0]; if (!n || n.at > end) break; q.shift(); t = n.at; n.fn(); } t = end; } }; };
export function fakeSession(o: { me?: string; role?: Role; members?: MemberLite[]; sendError?: { code: string } } = {}) {
  const c = clock(); const subs = new Set<(f: HandoffFrame) => void>(); const sent: { kind: string; body: { p?: Record<string, unknown> } }[] = []; let seq = 100; let role: Role = o.role ?? 'host';
  const s: HandoffSession & { sent: typeof sent; push(f: Omit<HandoffFrame, 'seq'> & { seq?: number }): void; setRole(r: Role): void; clock: ReturnType<typeof clock> } = {
    me: o.me ?? 'host1', clock: c, sent, role: () => role, setRole: (r) => { role = r; },
    members: () => o.members ?? [{ id: 'host1', role: 'host', connected: true }, { id: 'ed1', role: 'editor', connected: true }, { id: 'ed2', role: 'editor', connected: true }, { id: 'view1', role: 'viewer', connected: true }],
    send: async (kind, body) => { sent.push({ kind, body }); if (o.sendError) throw o.sendError; return { id: `msg_${sent.length}`, seq: ++seq }; },
    onFrame: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; }, push: (f) => { const full = { seq: ++seq, ...f } as HandoffFrame; for (const fn of [...subs]) fn(full); },
  };
  return s;
}
