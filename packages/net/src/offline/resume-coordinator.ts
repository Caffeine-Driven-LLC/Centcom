/** What the person should hear about catching up after being away. The session client does the work (hot resume, snapshot restore, REST history); this reports it once. */
import { TypedEmitter } from '../relay/emitter.js';
import type { SessionHandle } from '../session/client.js';
import type { SnapshotDoc } from '../session/types.js';
export class ResumeCoordinator extends TypedEmitter<{ 'history-incomplete': []; restored: [{ seq: number; doc: SnapshotDoc }] }> {
  private told = false; private readonly offs: (() => void)[];
  constructor(session: SessionHandle) { super(); this.offs = [session.on('snapshot', (s) => this.emit('restored', s)), session.on('protocol-warning', (w) => { if (w.reason === 'earlier_history_unavailable' && !this.told) { this.told = true; this.emit('history-incomplete'); } })]; }
  dispose(): void { for (const f of this.offs.splice(0)) f(); }
}
