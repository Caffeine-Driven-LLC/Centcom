import type { Page } from '@playwright/test';

export interface Problem { rule: string; node: string }
/** A structural accessibility check run inside the page (axe-core is not used: its licence, MPL-2.0, is not on the policy list; src/a11y/check.ts says the same). Self-contained because Playwright serialises it into the page. */
export async function a11yProblems(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const out: { rule: string; node: string }[] = []; const tag = (el: Element): string => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`;
    const named = (el: Element): boolean => !!((el.getAttribute('aria-label') ?? el.getAttribute('aria-labelledby') ?? el.getAttribute('title') ?? (el as HTMLElement).innerText ?? el.textContent ?? '').trim()) || !!el.querySelector('[aria-label]');
    for (const b of document.querySelectorAll('button,[role="button"]')) if (!named(b)) out.push({ rule: 'button-name', node: tag(b) });
    for (const a of document.querySelectorAll('a[href]')) if (!named(a)) out.push({ rule: 'link-name', node: tag(a) });
    for (const i of document.querySelectorAll('input:not([type=hidden]),select,textarea')) {
      const id = i.getAttribute('id');
      if (!i.getAttribute('aria-label') && !i.getAttribute('aria-labelledby') && !i.closest('label') && !(id && document.querySelector(`label[for="${CSS.escape(id)}"]`))) out.push({ rule: 'label', node: tag(i) });
    }
    for (const im of document.querySelectorAll('img')) if (!im.hasAttribute('alt')) out.push({ rule: 'image-alt', node: tag(im) });
    const seen = new Map<string, number>(); for (const e of document.querySelectorAll('[id]')) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    for (const [id, n] of seen) if (n > 1) out.push({ rule: 'duplicate-id', node: `#${id}` });
    if (!document.documentElement.lang) out.push({ rule: 'html-has-lang', node: 'html' });
    if (!document.title.trim()) out.push({ rule: 'document-title', node: 'title' });
    return out;
  });
}
