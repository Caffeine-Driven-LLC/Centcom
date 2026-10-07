// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { FocusTrap, SkipLink, useFocusReturn, useRoving } from '../../src/a11y/index.js';
import { ConfirmByName } from '../../src/workspace/components.js';
import { Modal } from '../../src/ui/index.js';

afterEach(cleanup);
describe('skip link and focus (acceptance 5)', () => {
  it('the skip link is the first tabbable element and moves focus to <main>', () => { render(<><SkipLink /><button type="button">first</button><main id="main"><p>content</p></main></>); const all = [...document.querySelectorAll<HTMLElement>('a[href],button,[tabindex]:not([tabindex="-1"])')]; expect(all[0]!.textContent).toBe('Skip to main content'); fireEvent.click(all[0]!); expect(document.activeElement).toBe(document.getElementById('main')); });
  const Host = ({ kind }: { kind: 'modal' | 'confirm' | 'trap' }) => { const [open, setOpen] = useState(false); useFocusReturn(kind === 'trap' && open); return <><button type="button" onClick={() => setOpen(true)}>open</button>{kind === 'modal' ? <Modal open={open} title="T" onClose={() => setOpen(false)}><button type="button" onClick={() => setOpen(false)}>x</button></Modal> : kind === 'confirm' ? <ConfirmByName open={open} verb="Remove member" name="A" onConfirm={() => setOpen(false)} onClose={() => setOpen(false)} /> : open ? <FocusTrap><button type="button" onClick={() => setOpen(false)}>x</button></FocusTrap> : null}</>; };
  for (const kind of ['modal', 'confirm', 'trap'] as const) it(`focus goes back to the button after the ${kind} closes`, () => { render(<Host kind={kind} />); const b = screen.getByText('open'); b.focus(); fireEvent.click(b); expect(document.activeElement).not.toBe(b); fireEvent.click(screen.getByText(kind === 'confirm' ? 'Cancel' : 'x')); expect(document.activeElement).toBe(b); });
  it('the trap keeps Tab inside', () => { render(<FocusTrap><button type="button">a</button><button type="button">b</button></FocusTrap>); const [a, b] = [screen.getByText('a'), screen.getByText('b')]; expect(document.activeElement).toBe(a); b.focus(); fireEvent.keyDown(b, { key: 'Tab' }); expect(document.activeElement).toBe(a); fireEvent.keyDown(a, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(b); });
  it('a roving group is one tab stop and arrows move inside it', () => { const G = () => { const r = useRoving(3); return <div>{['a', 'b', 'c'].map((x, i) => <button key={x} type="button" {...r.props(i)}>{x}</button>)}</div>; }; render(<G />); const [a, b, c] = ['a', 'b', 'c'].map((x) => screen.getByText(x)) as HTMLElement[]; expect([a!.tabIndex, b!.tabIndex, c!.tabIndex]).toEqual([0, -1, -1]); fireEvent.keyDown(a!, { key: 'ArrowDown' }); expect(document.activeElement).toBe(b); expect(b!.tabIndex).toBe(0); fireEvent.keyDown(b!, { key: 'End' }); expect(document.activeElement).toBe(c); fireEvent.keyDown(c!, { key: 'ArrowDown' }); expect(document.activeElement).toBe(a); });
});
