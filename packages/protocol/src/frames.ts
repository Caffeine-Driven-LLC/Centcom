/** Reading and writing frames and event payloads. Reads tolerate what a newer peer may add (CT-VER); writes are exact. */
import * as strict from './generated/validators-strict.js';
import * as tolerant from './generated/validators-tolerant.js';
import { AGENT_WIRE_STATES, type AgentWireState } from './generated/agent-state.js';
import { DEF_KIND, EVENT_MODES, FRAME_FIELDS, type EventKind, type PayloadMode } from './generated/event-kinds.js';
import type { Frame } from './generated/types.js';

export interface Issue { pointer: string; code: string }
export type ParseResult<T> = { ok: true; value: T; unknown?: boolean } | { ok: false; issues: Issue[] };
export class ProtocolError extends Error { constructor(public issues: Issue[]) { super(`Invalid message: ${issues.map((i) => `${i.pointer || '/'} ${i.code}`).join(', ')}`); this.name = 'ProtocolError'; } }

type Validator = ((data: unknown) => boolean) & { errors?: { instancePath: string; keyword: string }[] | null };
const issuesOf = (v: Validator): Issue[] => (v.errors ?? [{ instancePath: '', keyword: 'invalid' }]).map((e) => ({ pointer: e.instancePath, code: e.keyword }));
function run<T>(v: Validator, value: unknown): ParseResult<T> { return v(value) ? { ok: true, value: value as T } : { ok: false, issues: issuesOf(v) }; }

const S = strict as unknown as Record<string, Validator>; const T = tolerant as unknown as Record<string, Validator>;
/** kind -> its clear (p_*) and secret (s_*) schema definition */
const DEFS: Record<string, { p?: string; s?: string }> = {};
for (const [def, kind] of Object.entries(DEF_KIND)) (DEFS[kind] ??= {})[def.startsWith('p_') ? 'p' : 's'] = def;

export const payloadMode = (kind: string): PayloadMode | 'unknown' => (EVENT_MODES as Record<string, PayloadMode>)[kind] ?? 'unknown';
export const isEventKind = (kind: string): kind is EventKind => kind in EVENT_MODES;
export const isAgentWireState = (s: string): s is AgentWireState => (AGENT_WIRE_STATES as readonly string[]).includes(s);

/** Read side: unknown fields, unknown frame types, unknown enum values and unknown event kinds are all accepted. `unknown: true` flags an event kind we do not know. */
export function parseFrame(input: unknown): ParseResult<Frame> {
  const r = run<Frame>(T.read_envelope!, input); if (!r.ok) return r;
  const k = (r.value as { k?: string }).k; return k !== undefined && !isEventKind(k) ? { ...r, unknown: true } : r;
}

/** The cleartext `p` of an event. Unknown kinds pass through untouched. */
export function parseEventPayload(kind: string, p: unknown): ParseResult<unknown> {
  if (!isEventKind(kind)) return { ok: true, value: p, unknown: true };
  const def = DEFS[kind]?.p; if (!def) return { ok: false, issues: [{ pointer: '/p', code: 'no_clear_payload' }] }; // encrypted-only kinds carry no cleartext
  return run(T[`read_${def}`]!, p);
}
/** The decrypted secret of an encrypted or hybrid event. */
export function parseSecretPayload(kind: string, decrypted: unknown): ParseResult<unknown> {
  if (!isEventKind(kind)) return { ok: true, value: decrypted, unknown: true };
  const def = DEFS[kind]?.s; if (!def) return { ok: false, issues: [{ pointer: '', code: 'no_secret_payload' }] };
  return run(T[`read_${def}`]!, decrypted);
}

/** Write side: reject anything the schema does not define, including extra top-level fields and event kinds we do not know. */
export function assertWritableFrame(f: unknown): asserts f is Frame {
  const r = run<Frame>(S.write_envelope!, f); if (!r.ok) throw new ProtocolError(r.issues);
  const extra = Object.keys(f as object).filter((k) => !(FRAME_FIELDS as readonly string[]).includes(k)); if (extra.length) throw new ProtocolError(extra.map((k) => ({ pointer: `/${k}`, code: 'unknown_field' })));
  const k = (f as { k?: string }).k; if (k !== undefined && !isEventKind(k)) throw new ProtocolError([{ pointer: '/k', code: 'unknown_kind' }]);
}
export function assertWritableEventPayload(kind: EventKind, p: unknown): void {
  const def = DEFS[kind]?.p; if (!def) throw new ProtocolError([{ pointer: '/p', code: 'no_clear_payload' }]); const r = run(S[`write_${def}`]!, p); if (!r.ok) throw new ProtocolError(r.issues);
}
export function assertWritableSecretPayload(kind: EventKind, s: unknown): void {
  const def = DEFS[kind]?.s; if (!def) throw new ProtocolError([{ pointer: '', code: 'no_secret_payload' }]); const r = run(S[`write_${def}`]!, s); if (!r.ok) throw new ProtocolError(r.issues);
}

/** Validate any contract object by schema name (used by the fixture runner and by lanes that handle REST bodies). */
export function validateAgainst(schema: string, data: unknown, mode: 'strict' | 'tolerant' = 'tolerant'): ParseResult<unknown> {
  const name = `${mode === 'strict' ? 'write' : 'read'}_${schema.replace(/-/g, '_').replace(/\.schema(\.json)?$/, '')}`; const v = (mode === 'strict' ? S : T)[name];
  if (!v) throw new Error(`No validator for schema "${schema}"`); return run(v, data);
}
