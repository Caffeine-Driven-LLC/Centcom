// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { checkA11y } from '../../src/a11y/check.js';

/** The hand-written structural check (axe-core is MPL-2.0 and not allowed): every rule is proved by a page that breaks it and one that does not. */
const page = (html: string): HTMLElement => { const d = document.createElement('div'); d.innerHTML = html; document.body.replaceChildren(d); return d; };
const rules = (html: string): string[] => [...new Set(checkA11y(page(html)).map((x) => x.rule))];
describe('structural a11y rules', () => {
  const cases: [string, string, string][] = [
    ['button-name', '<button></button>', '<button>Save</button>'], ['link-name', '<a href="/x"></a>', '<a href="/x">Home</a>'], ['label', '<input type="text">', '<label>Name <input type="text"></label>'],
    ['image-alt', '<img src="a.png">', '<img src="a.png" alt="">'], ['duplicate-id', '<p id="a"></p><p id="a"></p>', '<p id="a"></p><p id="b"></p>'],
    ['dialog-name', '<div role="dialog"></div>', '<div role="dialog" aria-label="Invite"></div>'], ['heading-order', '<h1>A</h1><h3>B</h3>', '<h1>A</h1><h2>B</h2><h3>C</h3>'], ['empty-heading', '<h2></h2>', '<h2>Plans</h2>'],
    ['landmark-one-main', '<main></main><main></main>', '<main></main>'], ['aria-reference', '<input aria-label="x" aria-describedby="nope">', '<p id="hint">h</p><input aria-label="x" aria-describedby="hint">'],
    ['tabindex-positive', '<div tabindex="3"></div>', '<div tabindex="0"></div>'], ['aria-hidden-focusable', '<div aria-hidden="true"><button>Go</button></div>', '<div aria-hidden="true"><span>x</span></div>'],
    ['role-img-name', '<span role="img"></span>', '<span role="img" aria-label="Cento"></span>'], ['nested-interactive', '<a href="/x"><button>Go</button></a>', '<a href="/x">Go</a>'], ['role-name', '<div role="tab"></div>', '<div role="tab">Usage</div>'],
  ];
  it.each(cases)('%s is reported for a page that breaks it, and not for one that does not', (rule, broken, fine) => { expect(rules(broken)).toContain(rule); expect(rules(fine)).not.toContain(rule); });
  it('a whole well-formed page has no violation', () => { expect(rules('<main><h1>Billing</h1><h2>Usage</h2><button>Pay</button><label for="n">Name</label><input id="n"><table aria-label="Invoices"></table></main>')).toEqual([]); });
});
