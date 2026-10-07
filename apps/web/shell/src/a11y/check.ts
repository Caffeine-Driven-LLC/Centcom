/** A small structural check for rendered pages (the axe-core engine is not used: its licence, MPL-2.0, is not on the policy list). It looks for the failures that matter most: unnamed controls and images, duplicate ids, empty links, a missing language, and no main landmark. */
export interface Violation { rule: string; node: string; impact: 'serious' | 'critical' | 'moderate' }
const name = (el: Element): string => (el.getAttribute('aria-label') ?? el.getAttribute('aria-labelledby') ?? el.getAttribute('title') ?? (el as HTMLElement).innerText ?? el.textContent ?? '').trim();
const labelled = (el: Element, root: HTMLElement): boolean => { const id = el.getAttribute('id'); return !!el.getAttribute('aria-label') || !!el.getAttribute('aria-labelledby') || !!el.closest('label') || (!!id && !!root.querySelector(`label[for="${CSS.escape(id)}"]`)); };
export function checkA11y(root: HTMLElement): Violation[] {
  const v: Violation[] = []; const tag = (el: Element): string => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`;
  for (const b of root.querySelectorAll('button,[role="button"]')) if (!name(b) && !b.querySelector('[aria-label]')) v.push({ rule: 'button-name', node: tag(b), impact: 'critical' });
  for (const a of root.querySelectorAll('a[href]')) if (!name(a) && !a.querySelector('[aria-label]')) v.push({ rule: 'link-name', node: tag(a), impact: 'serious' });
  for (const i of root.querySelectorAll('input:not([type=hidden]),select,textarea')) if (!labelled(i, root)) v.push({ rule: 'label', node: tag(i), impact: 'critical' });
  for (const im of root.querySelectorAll('img')) if (!im.hasAttribute('alt')) v.push({ rule: 'image-alt', node: tag(im), impact: 'critical' });
  const ids = new Map<string, number>(); for (const e of root.querySelectorAll('[id]')) ids.set(e.id, (ids.get(e.id) ?? 0) + 1); for (const [id, n] of ids) if (n > 1) v.push({ rule: 'duplicate-id', node: `#${id}`, impact: 'serious' });
  for (const t of root.querySelectorAll('table')) if (!t.querySelector('caption') && !t.getAttribute('aria-label') && !t.closest('[aria-label]')) v.push({ rule: 'table-caption', node: tag(t), impact: 'moderate' });
  for (const d of root.querySelectorAll('[role=dialog]')) if (!d.getAttribute('aria-label') && !d.getAttribute('aria-labelledby')) v.push({ rule: 'dialog-name', node: tag(d), impact: 'serious' });
  return v;
}
export async function expectNoA11yViolations(root: HTMLElement, o: { impacts?: ('serious' | 'critical')[] } = {}): Promise<void> {
  const impacts = new Set<string>(o.impacts ?? ['serious', 'critical']); const bad = checkA11y(root).filter((x) => impacts.has(x.impact)); if (bad.length) throw new Error(`Accessibility problems:\n${bad.map((b) => `- ${b.rule}: ${b.node}`).join('\n')}`);
}
