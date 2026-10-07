// @vitest-environment jsdom
import { cleanup, render, screen, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { checkA11y, expectNoA11yViolations, setMotion, useReducedMotion } from '../../src/a11y/index.js';

afterEach(() => { cleanup(); setMotion(undefined); });
const css = readFileSync(join(process.cwd(), 'apps/web/src/ui/ui.css'), 'utf8');
describe('motion and forced colours (acceptance 6, 7)', () => {
  const P = () => <p>{useReducedMotion() ? 'reduced' : 'full'}</p>;
  it('the manual setting wins over the system one, both ways', () => { render(<P />); expect(screen.getByText('full')).toBeTruthy(); act(() => setMotion('reduced')); expect(screen.getByText('reduced')).toBeTruthy(); act(() => setMotion('full')); expect(screen.getByText('full')).toBeTruthy(); act(() => setMotion(undefined)); expect(screen.getByText('full')).toBeTruthy(); });
  it('the system setting is followed', () => { const mq = { matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }; const old = window.matchMedia; window.matchMedia = (() => mq) as never; try { render(<P />); expect(screen.getByText('reduced')).toBeTruthy(); } finally { window.matchMedia = old; } });
  it('every animation and transition in the stylesheet is cut to 0 ms under reduced motion', () => { const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)')); expect(reduce).toMatch(/animation-duration: 0ms !important/); expect(reduce).toMatch(/transition-duration: 0ms !important/); expect(reduce).toContain('animation: none'); const anims = [...css.matchAll(/animation:\s*([a-z-]+)\s+([\d.]+)s/g)]; expect(anims.length).toBeGreaterThan(0); });
  it('forced colours: borders and focus rings stay, and nothing is shown by colour alone', () => { const fc = css.slice(css.indexOf('@media (forced-colors: active)')); for (const sel of ['.cc-btn', '.cc-input', '.cc-modal', '.cc-banner']) expect(fc).toContain(sel); expect(fc).toMatch(/outline: 2px solid Highlight/); expect(fc).toMatch(/border: 1px solid CanvasText/); });
});
describe('the structural check', () => {
  it('finds the problems that matter and passes a good page', async () => {
    const bad = document.createElement('div'); bad.innerHTML = '<button></button><a href="/x"></a><input><img src="x"><div id="d"></div><div id="d"></div><table></table><div role="dialog"></div>'; document.body.append(bad); const rules = checkA11y(bad).map((v) => v.rule).sort(); expect(rules).toEqual(['button-name', 'dialog-name', 'duplicate-id', 'image-alt', 'label', 'link-name', 'table-caption']); await expect(expectNoA11yViolations(bad)).rejects.toThrow(/button-name/); bad.remove();
    const good = document.createElement('div'); good.innerHTML = '<label for="n">Name</label><input id="n"><button>Save</button><a href="/x">Home</a><img alt="" src="x"><table><caption>T</caption></table>'; document.body.append(good); await expectNoA11yViolations(good); good.remove();
  });
  it('the shell\'s own primitives pass it', async () => { const { Button, Input, Table, Tabs } = await import('../../src/ui/index.js'); render(<><Button>Go</Button><Input label="Email" /><Table caption="Rows" rows={[{ id: '1' }]} rowKey={(r) => r.id} columns={[{ key: 'i', header: 'Id', cell: (r) => r.id }]} /><Tabs label="T" tabs={[{ id: 'a', label: 'A', panel: <p>a</p> }]} /></>); await expectNoA11yViolations(document.body); });
});
