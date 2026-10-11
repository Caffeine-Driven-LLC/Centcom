import { toolKind } from '../state/mapping.js';
import type { NormalisedEvent } from '../types.js';
import type { Board } from './board.js';
import { cleanPath, cleanText } from './text.js';

/** Commands whose failure is worth telling the other agents about: tests, builds, type checks, linters. */
const CHECK = /\b(test|tests|vitest|jest|mocha|pytest|tsc|typecheck|build|lint|eslint|ruff|mypy|cargo|go test|make|gradle|mvn|rspec)\b/i;
export interface RecorderOptions {
  board: Board; /** A path as the agent wrote it, made relative to the project (undefined: outside it, so it is not recorded). */ rel(agentId: string, path: string): string | undefined;
  name(agentId: string): string; engine?(agentId: string): string | undefined;
}
export interface Recorder {
  /** Feed every event of every agent through here. */ event(agentId: string, ev: NormalisedEvent): void;
  /** An agent finished or was stopped: its claims end. */ ended(agentId: string): void;
  /** Two agents are changing the same file. */ conflict(agentId: string, otherId: string, path: string): void;
  /** An agent now holds a file for writing (the lock client said so). Pass the `generation` read before asking for the lock: a claim that arrives after the agent has ended is dropped. */ claim(agentId: string, path: string, generation?: number): void;
  /** Changes each time an agent ends; read it before asking for a lock. */ generation(agentId: string): number;
}
const firstLine = (s: string): string => s.split('\n').map((l) => l.trim()).find(Boolean) ?? '';

export function createRecorder(o: RecorderOptions): Recorder {
  const pending = new Map<string, Map<string, { name: string; command?: string; summary: string }>>(); const approvals = new Map<string, string>(); const gens = new Map<string, number>();
  const author = (id: string) => ({ kind: 'agent' as const, id, name: o.name(id), ...(o.engine?.(id) ? { engine: o.engine(id)! } : {}) });
  return {
    event(agentId, ev) {
      if (ev.type === 'tool.requested') {
        let m = pending.get(agentId); if (!m) { m = new Map(); pending.set(agentId, m); } m.set(ev.tool_id, { name: ev.name, command: ev.command, summary: ev.input_summary }); if (m.size > 200) m.delete(m.keys().next().value as string);
        const rel = ev.path ? o.rel(agentId, ev.path) : undefined; if (rel) o.board.touch(agentId, [rel]);
      } else if (ev.type === 'tool.result') {
        const t = pending.get(agentId)?.get(ev.tool_id); pending.get(agentId)?.delete(ev.tool_id);
        if (t && ev.status === 'error' && t.command && toolKind(t.name, t.command) === 'command' && CHECK.test(t.command)) {
          const why = cleanText(firstLine(ev.summary), 140); o.board.post({ author: author(agentId), type: 'finding', text: `\`${cleanText(t.command, 80)}\` failed${why ? `: ${why}` : ''}`, commands: [t.command] });
        }
      } else if (ev.type === 'approval.requested') { approvals.set(ev.approval_id, ev.summary); if (approvals.size > 100) approvals.delete(approvals.keys().next().value as string); }
      else if (ev.type === 'approval.resolved') {
        const what = approvals.get(ev.approval_id); approvals.delete(ev.approval_id);
        if (what && ev.decision === 'deny' && ev.by === 'user') o.board.post({ author: author(agentId), type: 'decision', text: `The user declined: ${cleanText(what, 160)}` });
      }
    },
    ended(agentId) { gens.set(agentId, (gens.get(agentId) ?? 0) + 1); o.board.endClaims(agentId); pending.delete(agentId); },
    generation: (agentId) => gens.get(agentId) ?? 0,
    conflict(agentId, otherId, path) { const f = cleanPath(path); if (!f) return; o.board.post({ author: author(agentId), type: 'warning', text: `${o.name(agentId)} and ${o.name(otherId)} are both changing ${f}; their branches will conflict there`, files: [f] }); },
    claim(agentId, path, generation) { if (generation !== undefined && generation !== (gens.get(agentId) ?? 0)) return; const f = cleanPath(path); if (!f) return; o.board.touch(agentId, [f]); o.board.post({ author: author(agentId), type: 'claim', text: `${o.name(agentId)} is changing ${f}`, files: [f] }); },
  };
}
/** One event into a recorder (the shape the runtime's observers use). */
export const recordEvent = (r: Recorder, agentId: string, ev: NormalisedEvent): void => r.event(agentId, ev);
export type { Recorder as BoardRecorder };
