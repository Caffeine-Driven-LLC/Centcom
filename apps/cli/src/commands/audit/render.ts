/** Table output for audit events. Anything that came from the server is cleaned before it reaches the terminal. */
export interface AuditEvent { id: string; at: string; action: string; result?: string; actor?: { type?: string; id?: string }; target?: { type?: string; id?: string }; metadata?: Record<string, unknown>; workspace?: string }
export function clean(v: unknown, max = 80): string {
  const s = String(v ?? '').replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g, '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\u001b./g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}...` : s;
}
const who = (a?: AuditEvent['actor']) => (a ? `${clean(a.type, 10)}${a.id ? `:${clean(a.id, 40)}` : ''}` : '-'); const what = (t?: AuditEvent['target']) => (t && (t.type || t.id) ? `${clean(t.type, 20)}${t.id ? `:${clean(t.id, 40)}` : ''}` : '-');
export function renderTable(events: AuditEvent[]): string[] {
  const rows = events.map((e) => [clean(e.at, 24).replace('T', ' ').replace(/\.\d+Z$/, 'Z'), who(e.actor), clean(e.action, 50), what(e.target), clean(e.result ?? '-', 10)]); const head = ['TIME', 'ACTOR', 'ACTION', 'TARGET', 'OUTCOME'];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length))); const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i]!)).join('  ').trimEnd(); return [line(head), ...rows.map(line)];
}
