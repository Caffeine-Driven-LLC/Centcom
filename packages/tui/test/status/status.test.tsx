import React from 'react';
import fc from 'fast-check';
import { renderToString } from 'ink';
import { describe, expect, it } from 'vitest';
import { STATUS_DROP_ORDER, ServiceBanner, StatusFooter, StatusHeader, bannerText, formatCost, layoutStatus, quotaChip, renderStatus, shortBranch, statusText, type StatusFields } from '../../src/status/index.js';
import { textWidth } from '../../src/util/text.js';

const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');
const full: StatusFields = { cwd: '/home/me/code/Centcom', home: '/home/me', branch: 'main', mode: 'accept-edits', agents: 3, online: 2, costMicroUsd: 420000, hints: ['ctrl+t tasks', '? help'] };
const header = (f: StatusFields, w: number) => renderStatus(layoutStatus(f, w, undefined, 'header'), w);
const footer = (f: StatusFields, w: number) => renderStatus(layoutStatus(f, w, undefined, 'footer'), w);

describe('layout', () => {
  it('everything fits at 120 columns; the DESIGN example fits at 80', () => {
    expect(header(full, 120)).toMatch(/^cento · ~\/code\/Centcom · main +● 3 agents · ☻ 2 online · \$0\.42$/); expect(textWidth(header(full, 80))).toBeLessThanOrEqual(80); expect(header(full, 80)).toContain('$0.42');
    expect(footer(full, 120)).toMatch(/^⏵⏵ accept edits on · main +ctrl\+t tasks · \? help$/); expect(footer(full, 120)).toContain('ctrl+t tasks · ? help');
  });
  it('property: no line is ever wider than the terminal (widths 20 to 200)', () => {
    fc.assert(fc.property(fc.integer({ min: 20, max: 200 }), fc.string({ maxLength: 40 }), fc.string({ maxLength: 60 }), fc.integer({ min: 0, max: 99 }), (w, branch, cwd, n) => {
      const f: StatusFields = { ...full, branch: branch || undefined, cwd: '/' + cwd, agents: n, online: n, role: 'host', connectivity: 'reconnecting', quota: { used: 99, limit: 100 } };
      expect(textWidth(header(f, w))).toBeLessThanOrEqual(w); expect(textWidth(footer(f, w))).toBeLessThanOrEqual(w);
    }), { numRuns: 300 });
  });
  it('drops hints, cost, online, agents, branch, then mode, in that order, and the order is a constant', () => {
    expect(STATUS_DROP_ORDER).toEqual(['hints', 'cost', 'online', 'agents', 'branch', 'mode']);
    const names = (w: number) => layoutStatus(full, w, undefined, 'header').map((s) => s.field); expect(names(200)).toContain('cost'); expect(names(60)).not.toContain('cost'); expect(names(60)).toContain('agents');
    const o = layoutStatus(full, 55, ['agents'], 'header').map((s) => s.field); expect(o).not.toContain('agents'); expect(o).toContain('cost'); /* changing the order changes what is dropped */
    const f = layoutStatus(full, 30, undefined, 'footer').map((s) => s.field); expect(f).not.toContain('hints'); expect(f).toContain('mode'); const tiny = layoutStatus(full, 22, undefined, 'footer').map((s) => s.field); expect(tiny).toContain('mode');
  });
  it('a long branch name is cut with … and never pushes other fields out', () => {
    expect(shortBranch('agent/feature-refactor-the-whole-thing')).toBe('agent/feature-r…'); expect(shortBranch('main')).toBe('main'); const l = header({ ...full, branch: 'agent/feature-refactor-the-whole-thing' }, 120); expect(l).toContain('agent/feature-r…'); expect(l).toContain('$0.42');
  });
});

describe('chips', () => {
  it('quota: nothing at 30 %, quota 82% as a warning, quota 100% as danger, nothing when unlimited', () => {
    expect(quotaChip({ used: 1830, limit: 6000 })).toBeUndefined(); expect(quotaChip({ used: 4900, limit: 6000 })).toEqual({ text: 'quota 82%', tone: 'warning' }); expect(quotaChip({ used: 6000, limit: 6000 })).toEqual({ text: 'quota 100%', tone: 'danger' }); expect(quotaChip({ used: 5, limit: null })).toBeUndefined();
    expect(header({ ...full, quota: { used: 4900, limit: 6000 } }, 120)).toContain('quota 82%');
  });
  it('cost: 420000 is $0.42, 0 is $0.00, hidden by status.showCost=false', () => { expect([formatCost(420000), formatCost(0)]).toEqual(['$0.42', '$0.00']); expect(header({ ...full, costMicroUsd: 0 }, 120)).toContain('$0.00'); expect(header({ ...full, showCost: false }, 120)).not.toContain('$'); });
  it('role and connectivity chips are words', () => { const l = header({ ...full, role: 'viewer', connectivity: 'offline' }, 120); expect(l).toContain('VIEW'); expect(l).toContain('offline'); expect(header({ ...full, role: 'host' }, 120)).toContain('HOST'); expect(header({ ...full, connectivity: 'online', online: undefined }, 120)).not.toContain('offline'); });
});

describe('banner and sentence', () => {
  it('degraded shows the local wording; operational, unknown or no hosted session show nothing', () => {
    expect(bannerText({ status: 'degraded', incidentTitle: 'DROP TABLE' })).toBe('Relay is degraded. Local and LAN sessions are not affected.'); expect(bannerText({ status: 'operational' })).toBeNull(); expect(bannerText(null)).toBeNull(); expect(bannerText({ status: 'degraded' }, false)).toBeNull(); expect(bannerText({ status: 'weird' as never })).toBeNull();
    expect(strip(renderToString(<ServiceBanner status={{ status: 'degraded', incidentTitle: 'evil' }} />, { columns: 80 }))).not.toContain('evil'); expect(renderToString(<ServiceBanner status={{ status: 'operational' }} />, { columns: 80 })).toBe('');
  });
  it('statusText is one sentence under 120 characters without glyphs', () => {
    const t = statusText(full); expect(t).toBe('Cento in ~/code/Centcom on main, accept edits on, 3 agents, 2 online, cost 42 cents.'.replace('~', 'home')); expect(t.length).toBeLessThan(120); expect(t).not.toMatch(/[●☻⏵·]/); expect(statusText({ cwd: '/x', agents: 1 })).toContain('1 agent.');
  });
});

describe('rendering', () => {
  it('header and footer render as one row each, with the separators kept (the words carry the meaning without colour)', () => {
    const h = strip(renderToString(<StatusHeader fields={{ ...full, quota: { used: 4900, limit: 6000 } }} width={100} />, { columns: 100 })); expect(h.split('\n').filter(Boolean)).toHaveLength(1); expect(h).toContain(' · '); expect(h).toContain('quota 82%');
    const f = strip(renderToString(<StatusFooter fields={full} width={80} />, { columns: 80 })); expect(f.split('\n').filter(Boolean)).toHaveLength(1); expect(f).toContain('⏵⏵ accept edits on · main'); expect(f).toContain('? help');
  });
});
