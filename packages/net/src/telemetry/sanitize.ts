import { ERROR_TABLE, isAgentWireState } from '@centcom/protocol';

export type Props = Record<string, string | number | boolean>;
export type EventType = 'app.start' | 'app.exit' | 'command.run' | 'session.created' | 'session.joined' | 'agent.state_change' | 'feature.used' | 'error.shown' | 'perf.startup' | 'perf.frame' | 'update.result';
/** Each field of each event has a pattern or an enum. Anything else is `undefined`: the event is dropped and counted, never sent. */
const COMMAND = /^[a-z][a-z0-9-]{0,31}$/; const KEY = /^[a-z][a-z0-9_.-]{0,47}$/; const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[a-z0-9.]{1,16})?$/;
const MODES = new Set(['command_post', 'branch']); const TRANSPORTS = new Set(['lan', 'relay']);
const int = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;

/** Names that end like a host name or a file: a key that looks like `alexs-macbook.local` or `notes.txt` is not a feature. */
const HOSTLIKE = /\.(local|lan|localhost|internal|home|corp|intranet|com|net|org|io|dev|app|co|edu|gov|ai|me|us|uk|de|fr|eu|xyz|sh|txt|md|json|ts|js|log|env|yml|yaml|toml|key|pem)$/;
export function sanitize(type: EventType, a: Record<string, unknown>, o: { commands?: ReadonlySet<string>; /** The product's own feature keys. When given, nothing else passes. */ features?: ReadonlySet<string> } = {}): Props | undefined | null {
  switch (type) {
    case 'app.start': case 'app.exit': return null; // no properties
    case 'command.run': return typeof a.name === 'string' && COMMAND.test(a.name) && (!o.commands || o.commands.has(a.name)) ? { name: a.name } : undefined;
    case 'session.created': return typeof a.mode === 'string' && MODES.has(a.mode) && typeof a.transport === 'string' && TRANSPORTS.has(a.transport) ? { mode: a.mode, transport: a.transport } : undefined;
    case 'session.joined': return typeof a.transport === 'string' && TRANSPORTS.has(a.transport) ? { transport: a.transport } : undefined;
    case 'agent.state_change': return typeof a.from === 'string' && typeof a.to === 'string' && isAgentWireState(a.from) && isAgentWireState(a.to) ? { from: a.from, to: a.to } : undefined;
    case 'feature.used': return typeof a.key === 'string' && KEY.test(a.key) && !HOSTLIKE.test(a.key) && (!o.features || o.features.has(a.key)) ? { key: a.key } : undefined;
    case 'error.shown': return typeof a.code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_TABLE, a.code) ? { code: a.code } : undefined;
    case 'perf.startup': return int(a.ms, 600_000) ? { ms: Math.round(a.ms as number) } : undefined;
    case 'perf.frame': return int(a.p95_ms, 10_000) ? { p95_ms: Math.round((a.p95_ms as number) * 10) / 10 } : undefined;
    case 'update.result': return typeof a.from === 'string' && typeof a.to === 'string' && VERSION.test(a.from) && VERSION.test(a.to) && typeof a.ok === 'boolean' ? { from: a.from, to: a.to, ok: a.ok } : undefined;
  }
}
