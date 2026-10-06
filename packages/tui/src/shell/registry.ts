/** Actions and where their keys go: the key goes to the action whose context matches the top of the focus stack, and an overlay beats the prompt. */
export type FocusContext = 'prompt' | 'overlay' | 'transcript' | 'rail';
export interface ActionDef { id: string; group: string; description: string; defaultKey?: string; context?: FocusContext; run: () => void | Promise<void> }
export class DuplicateActionError extends Error { constructor(readonly id: string) { super(`action ${id} is already registered`); this.name = 'DuplicateActionError'; } }
export interface ActionRegistry { register(a: ActionDef): () => void; list(): ActionDef[]; /** Runs the action for a key given the focus stack (top last); returns whether one ran. */ dispatch(key: string, focus: FocusContext[]): boolean }
export function createActionRegistry(): ActionRegistry {
  const all = new Map<string, ActionDef>();
  return {
    register(a) { if (all.has(a.id)) throw new DuplicateActionError(a.id); all.set(a.id, a); return () => { if (all.get(a.id) === a) all.delete(a.id); }; },
    list: () => [...all.values()],
    dispatch(key, focus) { const top = focus.at(-1) ?? 'prompt'; const hit = [...all.values()].find((a) => a.defaultKey === key && (a.context === top || (a.context === undefined))) ?? undefined; if (!hit) return false; void hit.run(); return true; },
  };
}
export class FocusStack { private s: FocusContext[] = ['prompt']; push(c: FocusContext) { this.s.push(c); } pop() { if (this.s.length > 1) this.s.pop(); } get current(): FocusContext { return this.s.at(-1)!; } get stack(): FocusContext[] { return [...this.s]; } }
