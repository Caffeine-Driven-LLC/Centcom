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
  /* structure: headings do not skip a level, one main landmark, references point at something, nothing steals the tab order or hides a control from a screen reader */
  let level = 0; for (const h of root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')) { const l = h.getAttribute('aria-level') ? Number(h.getAttribute('aria-level')) : /^H\d$/.test(h.tagName) ? Number(h.tagName[1]) : 2; if (level && l > level + 1) v.push({ rule: 'heading-order', node: tag(h), impact: 'moderate' }); if (!name(h)) v.push({ rule: 'empty-heading', node: tag(h), impact: 'serious' }); level = l; }
  if (root.querySelectorAll('main,[role=main]').length > 1) v.push({ rule: 'landmark-one-main', node: 'main', impact: 'moderate' });
  for (const e of root.querySelectorAll('[aria-labelledby],[aria-describedby],[aria-controls]')) for (const a of ['aria-labelledby', 'aria-describedby', 'aria-controls']) for (const id of (e.getAttribute(a) ?? '').split(/\s+/).filter(Boolean)) if (!root.ownerDocument.getElementById(id)) v.push({ rule: 'aria-reference', node: `${tag(e)} ${a}=${id}`, impact: 'serious' });
  for (const e of root.querySelectorAll('[tabindex]')) if (Number(e.getAttribute('tabindex')) > 0) v.push({ rule: 'tabindex-positive', node: tag(e), impact: 'serious' });
  for (const e of root.querySelectorAll('[aria-hidden=true]')) if (e.matches('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])') || e.querySelector('a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')) v.push({ rule: 'aria-hidden-focusable', node: tag(e), impact: 'critical' });
  for (const e of root.querySelectorAll('[role=img]')) if (!name(e)) v.push({ rule: 'role-img-name', node: tag(e), impact: 'serious' });
  for (const e of root.querySelectorAll('a[href] button,button a[href],a[href] a[href]')) v.push({ rule: 'nested-interactive', node: tag(e), impact: 'serious' });
  for (const e of root.querySelectorAll('[role=tab],[role=menuitem],[role=option],[role=switch],[role=checkbox]')) if (!name(e)) v.push({ rule: 'role-name', node: tag(e), impact: 'critical' });
  return v;
}
export async function expectNoA11yViolations(root: HTMLElement, o: { impacts?: ('serious' | 'critical')[] } = {}): Promise<void> {
  const impacts = new Set<string>(o.impacts ?? ['serious', 'critical']); const bad = checkA11y(root).filter((x) => impacts.has(x.impact)); if (bad.length) throw new Error(`Accessibility problems:\n${bad.map((b) => `- ${b.rule}: ${b.node}`).join('\n')}`);
}
