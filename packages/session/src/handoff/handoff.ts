/** Handing the command post to a teammate (lane C079). Nothing is assumed until the server-stamped `control.host_changed` arrives. */
import type { HandoffFrame, HandoffResult, HandoffProgress, HandoffSession, MemberId, Unsubscribe } from './types.js';

export const HANDOFF_TIMEOUT_MS = 10_000;
/** Refuses host actions (approve, claim) once the transfer frame is sequenced, whatever the person clicked: the old host stops at the frame's seq. */
export class HostActionGate {
  private frozenAt?: number; private lastSeq = 0;
  /** Call with the seq of every frame the host engine has handled. */
  seen(seq: number): void { if (seq > this.lastSeq) this.lastSeq = seq; }
  freezeAt(seq: number): void { this.frozenAt = Math.min(this.frozenAt ?? Infinity, seq); }
  thaw(): void { this.frozenAt = undefined; }
  get frozen(): boolean { return this.frozenAt !== undefined && this.lastSeq >= this.frozenAt; }
  /** `true` when a host action stamped at `seq` (or now, without one) is still allowed. */
  allowed(seq?: number): boolean { return this.frozenAt === undefined || (seq !== undefined ? seq < this.frozenAt : false); }
}
export function onHostChanged(session: Pick<HandoffSession, 'onFrame'>, cb: (e: { host: MemberId; code: 'transfer' | 'failover'; seq: number }) => void): Unsubscribe {
  return session.onFrame((f) => { if (f.kind !== 'control.host_changed' || typeof f.p?.host !== 'string') return; const code = f.p.code === 'failover' ? 'failover' : 'transfer'; cb({ host: f.p.host, code, seq: f.seq }); });
}
const codeOf = (e: unknown): string => (typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : '');

export interface HandoffOptions { timeoutMs?: number; gate?: HostActionGate; onProgress?: (p: HandoffProgress) => void }
/** Asks the server to make `to` the host. Resolves `ok` only on `control.host_changed` naming `to`. */
export function requestHandoff(host: HandoffSession, to: MemberId, opts: HandoffOptions = {}): Promise<HandoffResult> {
  const fail = (code: Extract<HandoffResult, { ok: false }>['code']): Promise<HandoffResult> => Promise.resolve({ ok: false, code });
  if (host.role() !== 'host') return fail('forbidden');
  const target = host.members().find((m) => m.id === to); if (!target || target.role !== 'editor' || to === host.me) return fail('not_editor'); if (target.missingKeys) return fail('keys_missing');
  return new Promise<HandoffResult>((resolve) => {
    let settled = false; let timer: unknown; let off: Unsubscribe | undefined; let mySeq: number | undefined;
    const done = (r: HandoffResult, p: HandoffProgress): void => { if (settled) return; settled = true; if (timer !== undefined) host.clock.clearTimeout(timer as never); off?.(); opts.onProgress?.(p); resolve(r); };
    opts.onProgress?.('requested');
    timer = host.clock.setTimeout(() => done({ ok: false, code: 'timeout' }, 'failed'), opts.timeoutMs ?? HANDOFF_TIMEOUT_MS);
    off = host.onFrame((f: HandoffFrame) => {
      if (f.kind === 'control.host_changed' && typeof f.p?.host === 'string' && f.p.code !== 'failover') { if (f.p.host === to && (mySeq === undefined || f.seq > mySeq)) return done({ ok: true, newHost: to }, 'done'); return done({ ok: false, code: 'superseded' }, 'failed'); }
      if (f.kind === 'control.host_changed') return done({ ok: false, code: 'superseded' }, 'failed'); /* a failover decided it */
      if (f.kind === 'control.member_left' && f.p?.member === to) return done({ ok: false, code: 'superseded' }, 'failed'); /* the target left or was kicked first */
    });
    host.send('control.transfer_host', { p: { to } }).then((r) => { mySeq = r.seq; opts.gate?.freezeAt(r.seq); opts.onProgress?.('accepted'); }).catch((e: unknown) => {
      /* refused: if the host changed under us it was a rival request that came first, otherwise we simply were not allowed */
      done({ ok: false, code: host.role() !== 'host' ? 'superseded' : codeOf(e) === 'forbidden' ? 'forbidden' : 'timeout' }, 'failed');
    });
  });
}

/** Follows who the host is, for the engine and the screen: a transfer or a failover only changes the role, it never reconnects, and anything the caller keeps (a half-typed prompt) is not touched. */
export function watchRole(session: Pick<HandoffSession, 'onFrame' | 'me'>, onRole: (e: { role: 'host' | 'editor'; host: MemberId; code: 'transfer' | 'failover'; seq: number }) => void): Unsubscribe {
  return onHostChanged(session, (e) => onRole({ role: e.host === session.me ? 'host' : 'editor', host: e.host, code: e.code, seq: e.seq }));
}
