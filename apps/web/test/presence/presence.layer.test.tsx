// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setMotion } from '../../src/a11y/index.js';
import { CursorLayer, ENTER_MS, LEAVE_MS, PresenceStack, usePresencePublisher, type Member, type Sink } from '../../src/presence/index.js';

afterEach(() => { cleanup(); setMotion(undefined); vi.useRealTimers(); });
const roster = [{ id: 'me', name: 'Me', slot: 0 }, { id: 'maya', name: 'Maya', slot: 1 }, { id: 'ben', name: 'Ben', slot: 2 }];
const cur = (member: string, receivedAt: number, o: Record<string, unknown> = {}) => ({ member, path: 'a.ts', line: 4, col: 7, receivedAt, ...o });

describe('the cursor layer (C085 acceptance 4)', () => {
  it('draws a 4 x 6 pixel arrow with the name and initial on a tag, at the line and column, and never your own', () => {
    render(<CursorLayer cursors={new Map([['maya', cur('maya', 0)], ['me', cur('me', 0)]])} roster={roster} me="me" path="a.ts" now={100} />);
    const marks = document.querySelectorAll<HTMLElement>('.cc-cursor'); expect(marks).toHaveLength(1); const m = marks[0]!;
    expect(m.textContent).toBe('M Maya'); expect(m.style.getPropertyValue('--cu-line')).toBe('4'); expect(m.style.getPropertyValue('--cu-col')).toBe('7');
    const svg = m.querySelector('svg')!; expect(svg.getAttribute('viewBox')).toBe('0 0 4 6'); expect(svg.getAttribute('width')).toBe('12'); expect(svg.getAttribute('height')).toBe('18'); expect(svg.getAttribute('shape-rendering')).toBe('crispEdges');
    expect(screen.getByTestId('cursor-layer').getAttribute('aria-hidden')).toBe('true');
  });
  it('is at 40 % opacity after 3 s without news and gone at 10 s; someone who left the roster is gone at once; another file is not drawn', () => {
    const at = (now: number, r = roster, path = 'a.ts') => { cleanup(); render(<CursorLayer cursors={[cur('maya', 0)]} roster={r} me="me" path={path} now={now} />); return document.querySelector<HTMLElement>('.cc-cursor'); };
    expect(at(2999)!.style.opacity).toBe('1'); expect(at(3000)!.style.opacity).toBe('0.4'); expect(at(3000)!.getAttribute('data-dim')).toBe('true'); expect(at(10_000)).toBeNull();
    expect(at(100, roster.filter((m) => m.id !== 'maya'))).toBeNull(); expect(at(100, roster, 'b.ts')).toBeNull();
  });
  it('fades and expires on its own clock from the time the frame arrived here', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000); render(<CursorLayer cursors={[cur('maya', 1_000_000)]} roster={roster} me="me" path="a.ts" />);
    expect(document.querySelector<HTMLElement>('.cc-cursor')!.style.opacity).toBe('1'); act(() => { vi.advanceTimersByTime(3500); }); expect(document.querySelector<HTMLElement>('.cc-cursor')!.style.opacity).toBe('0.4'); act(() => { vi.advanceTimersByTime(7000); }); expect(document.querySelector('.cc-cursor')).toBeNull();
  });
  it('shows the sixth person violet with an outline and the name on the tag', () => {
    const six = [...roster, { id: 'c', name: 'Cy', slot: 3 }, { id: 'd', name: 'Di', slot: 4 }, { id: 'e', name: 'Ed', slot: 5 }, { id: 'f', name: 'Fay', slot: 6 }];
    render(<CursorLayer cursors={[cur('f', 0)]} roster={six} me="me" path="a.ts" now={1} />); const m = document.querySelector('.cc-cursor')!; expect(m.getAttribute('data-colour')).toBe('violet-outlined'); expect(m.textContent).toBe('F Fay');
  });
});

describe('avatars come and go with motion (C085 scope)', () => {
  const m = (id: string, name: string, slot: number): Member => ({ id, name, slot, role: 'editor', connected: true });
  const stack = (members: Member[]) => <PresenceStack members={members} me="me" status={() => 'online'} onOpen={() => undefined} />;
  it('the first list does not animate; a joiner enters for 160 ms and a leaver is shown leaving for 280 ms', () => {
    vi.useFakeTimers(); const { rerender } = render(stack([m('me', 'Me', 0), m('maya', 'Maya', 1)])); expect(document.querySelectorAll('[data-phase]')).toHaveLength(0);
    rerender(stack([m('me', 'Me', 0), m('maya', 'Maya', 1), m('ben', 'Ben', 2)])); expect(document.querySelector('[data-phase="enter"]')?.getAttribute('aria-label')).toBe('Ben, online'); act(() => { vi.advanceTimersByTime(ENTER_MS + 1); }); expect(document.querySelectorAll('[data-phase="enter"]')).toHaveLength(0);
    rerender(stack([m('me', 'Me', 0), m('ben', 'Ben', 2)])); expect(document.querySelector('[data-phase="leave"]')?.getAttribute('aria-label')).toBe('Maya, offline'); act(() => { vi.advanceTimersByTime(LEAVE_MS + 1); }); expect(document.querySelectorAll('[data-phase]')).toHaveLength(0);
  });
  it('under reduced motion nobody animates', () => {
    setMotion('reduced'); const { rerender } = render(stack([m('me', 'Me', 0)])); rerender(stack([m('me', 'Me', 0), m('maya', 'Maya', 1)])); expect(document.querySelectorAll('[data-phase]')).toHaveLength(0); rerender(stack([m('me', 'Me', 0)])); expect(document.querySelectorAll('[data-phase]')).toHaveLength(0);
  });
});

describe('usePresencePublisher', () => {
  function Probe({ sink, onReady }: { sink?: Sink; onReady(c: ReturnType<typeof usePresencePublisher>): void }): null { onReady(usePresencePublisher(sink)); return null; }
  it('sends a change once, throttled to one update a second and ten cursors a second, and stops when the page closes', () => {
    vi.useFakeTimers(); const updates: unknown[] = []; const cursors: unknown[] = []; const sink: Sink = { update: (p) => updates.push(p), cursor: (c) => cursors.push(c) }; let ctl!: ReturnType<typeof usePresencePublisher>;
    const { unmount } = render(<Probe sink={sink} onReady={(c) => { ctl = c; }} />);
    ctl.setStatus('busy'); ctl.setStatus('busy'); expect(updates).toEqual([{ status: 'busy', activity: 'idle' }]); ctl.setActivity('reviewing'); expect(updates).toHaveLength(1); act(() => { vi.advanceTimersByTime(1000); }); expect(updates.at(-1)).toMatchObject({ activity: 'reviewing' });
    for (let i = 0; i < 100; i++) ctl.cursor({ line: i }); act(() => { vi.advanceTimersByTime(1000); }); expect(cursors.length).toBeLessThanOrEqual(11);
    ctl.input(true); act(() => { vi.advanceTimersByTime(400); vi.advanceTimersByTime(1000); }); expect(updates.at(-1)).toMatchObject({ activity: 'typing' }); act(() => { vi.advanceTimersByTime(5000); }); expect(updates.at(-1)).toMatchObject({ activity: 'idle' });
    unmount(); const n = updates.length; act(() => { vi.advanceTimersByTime(400_000); }); expect(updates).toHaveLength(n);
  });
  it('drops everything without a sink: presence is best effort', () => { vi.useFakeTimers(); let ctl!: ReturnType<typeof usePresencePublisher>; render(<Probe onReady={(c) => { ctl = c; }} />); expect(() => { ctl.setStatus('busy'); ctl.cursor({ line: 1 }); act(() => { vi.advanceTimersByTime(2000); }); }).not.toThrow(); });
});
