/** A list you tick several things in: pure state so it is testable without a terminal. */
export interface PickOption { id: string; label: string; hint?: string }
export interface PickState { title: string; note?: string; options: PickOption[]; checked: string[]; sel: number; multi: boolean; confirm: string }

export const newPick = (o: { title: string; note?: string; options: PickOption[]; checked?: string[]; multi?: boolean; confirm?: string }): PickState =>
  ({ title: o.title, note: o.note, options: o.options, checked: (o.checked ?? []).filter((id) => o.options.some((x) => x.id === id)), sel: Math.max(0, o.options.findIndex((x) => (o.checked ?? []).includes(x.id))), multi: o.multi !== false, confirm: o.confirm ?? 'confirm' });
export const pickMove = (p: PickState, d: number): PickState => ({ ...p, sel: p.options.length ? (p.sel + d + p.options.length) % p.options.length : 0 });
export const pickToggle = (p: PickState): PickState => {
  const o = p.options[p.sel]; if (!o) return p;
  if (!p.multi) return { ...p, checked: [o.id] };
  return { ...p, checked: p.checked.includes(o.id) ? p.checked.filter((x) => x !== o.id) : [...p.checked, o.id] };
};
/** `a`: tick everything, or untick everything when all are ticked. */
export const pickAll = (p: PickState): PickState => (!p.multi ? p : { ...p, checked: p.checked.length === p.options.length ? [] : p.options.map((o) => o.id) });
/** What Enter returns: the ticked ids in list order; a single-choice list returns the highlighted one. */
export const pickResult = (p: PickState): string[] => (p.multi ? p.options.filter((o) => p.checked.includes(o.id)).map((o) => o.id) : p.options[p.sel] ? [p.options[p.sel]!.id] : []);
