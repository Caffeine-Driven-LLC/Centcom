// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar, Banner, Button, Chip, EmptyState, Input, LiveRegion, Modal, PixelIcon, PresenceDot, Skeleton, Table, Tabs, ToastProvider, Tooltip, VisuallyHidden, useToast } from '../../shell/src/ui/index.js';

afterEach(cleanup);
describe('Button, Input and friends', () => {
  it('a disabled button explains itself and does not fire', () => { const f = vi.fn(); render(<Button disabledReason="Pick a workspace first" onClick={f}>Save</Button>); const b = screen.getByRole('button', { name: 'Save' }); expect(b.getAttribute('aria-disabled')).toBe('true'); expect(screen.getByRole('tooltip').textContent).toBe('Pick a workspace first'); expect(b.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id); fireEvent.click(b); expect(f).not.toHaveBeenCalled(); });
  it('every variant renders and a normal click fires once', () => { const f = vi.fn(); render(<>{(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => <Button key={v} variant={v} onClick={v === 'secondary' ? f : undefined}>{v}</Button>)}</>); fireEvent.click(screen.getByText('secondary')); expect(f).toHaveBeenCalledTimes(1); expect(document.querySelectorAll('.cc-btn--primary')).toHaveLength(1); });
  it('an input has its label and says what is wrong', () => { render(<Input label="Email" error="Not an email" />); const i = screen.getByLabelText('Email'); expect(i.getAttribute('aria-invalid')).toBe('true'); expect(i.getAttribute('aria-describedby')).toBeTruthy(); expect(screen.getByText('Not an email')).toBeTruthy(); });
  it('avatars, dots, chips, banners, skeletons, tooltips, icons and empty states have text or labels for assistive tech', () => {
    render(<><Avatar name="Ada" slot={7} /><PresenceDot status="away" /><Chip tone="success">ok</Chip><Banner tone="danger" title="Oops">bad</Banner><Skeleton lines={3} /><Tooltip text="more"><button type="button">i</button></Tooltip><PixelIcon name="home" label="Home" /><EmptyState title="Nothing">here</EmptyState><LiveRegion>hi</LiveRegion><VisuallyHidden>secret</VisuallyHidden></>);
    expect(screen.getByRole('img', { name: 'Ada' }).textContent).toBe('A'); expect(screen.getByRole('img', { name: 'away' })).toBeTruthy(); expect(screen.getAllByRole('alert')).toHaveLength(1); expect(screen.getByRole('status').textContent).toBe('hi'); expect(screen.getByRole('img', { name: 'Home' })).toBeTruthy(); expect(document.querySelectorAll('.cc-skel__line')).toHaveLength(3); expect(screen.getByRole('button', { name: 'i' }).getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  });
  it('a table has a caption and column headers', () => { render(<Table caption="Members" rows={[{ id: '1', n: 'Ada' }]} rowKey={(r) => r.id} columns={[{ key: 'n', header: 'Name', cell: (r) => r.n }]} />); expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy(); expect(screen.getByRole('region', { name: 'Members' })).toBeTruthy(); expect(screen.getByRole('cell', { name: 'Ada' })).toBeTruthy(); });
});
describe('Tabs (acceptance 8)', () => {
  it('arrow keys, Home and End move between tabs, wrapping; only the active panel shows', () => {
    const f = vi.fn(); render(<Tabs label="Sections" onChange={f} tabs={[{ id: 'a', label: 'A', panel: <p>panel a</p> }, { id: 'b', label: 'B', panel: <p>panel b</p> }, { id: 'c', label: 'C', panel: <p>panel c</p> }]} />);
    const list = screen.getByRole('tablist'); expect(screen.getByText('panel a')).toBeTruthy(); expect(screen.queryByText('panel b')).toBeNull(); fireEvent.keyDown(list, { key: 'ArrowRight' }); expect(screen.getByRole('tab', { name: 'B' }).getAttribute('aria-selected')).toBe('true'); expect(screen.getByText('panel b')).toBeTruthy();
    fireEvent.keyDown(list, { key: 'End' }); expect(screen.getByRole('tab', { name: 'C' }).getAttribute('aria-selected')).toBe('true'); fireEvent.keyDown(list, { key: 'ArrowRight' }); expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true'); fireEvent.keyDown(list, { key: 'ArrowLeft' }); expect(screen.getByRole('tab', { name: 'C' }).getAttribute('aria-selected')).toBe('true'); fireEvent.keyDown(list, { key: 'Home' }); expect(f).toHaveBeenLastCalledWith('a');
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('tabindex')).toBe('0'); expect(screen.getByRole('tab', { name: 'B' }).getAttribute('tabindex')).toBe('-1');
  });
});
describe('Modal (acceptance 8)', () => {
  const Host = ({ dirty = false, onClose }: { dirty?: boolean; onClose: () => void }) => { const [open, setOpen] = React.useState(false); return <><button type="button" onClick={() => setOpen(true)}>open</button><Modal open={open} title="Rename" dirty={dirty} onClose={() => { setOpen(false); onClose(); }}><input aria-label="name" /><button type="button">OK</button></Modal></>; };
  it('moves focus in, keeps Tab inside, gives focus back on close, closes on Esc', () => {
    const f = vi.fn(); render(<Host onClose={f} />); const opener = screen.getByText('open'); opener.focus(); fireEvent.click(opener); const input = screen.getByLabelText('name'); expect(document.activeElement).toBe(input); const ok = screen.getByText('OK'); ok.focus(); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' }); expect(document.activeElement).toBe(input); input.focus(); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(ok);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(f).toHaveBeenCalledTimes(1); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
  });
  it('Esc does nothing while there is unsaved input', () => { const f = vi.fn(); render(<Host dirty onClose={f} />); fireEvent.click(screen.getByText('open')); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(f).not.toHaveBeenCalled(); expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true'); });
});
describe('Toast', () => {
  it('shows at most three, announces them, and a dismiss removes one', () => {
    const Push = () => { const { toast } = useToast(); return <button type="button" onClick={() => toast('danger', `t${Math.random()}`)}>go</button>; }; render(<ToastProvider ttlMs={0}><Push /></ToastProvider>); for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('go')); const region = screen.getByRole('region', { name: 'Notifications' }); expect(region.querySelectorAll('.cc-banner')).toHaveLength(3); fireEvent.click(region.querySelector('button')!); expect(region.querySelectorAll('.cc-banner')).toHaveLength(2);
  });
});
