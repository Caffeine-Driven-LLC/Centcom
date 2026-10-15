// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { SessionPanel } from '../../src/local/SessionPanel.js';
import { emptyView } from '../../src/local/model.js';

afterEach(cleanup);
const counters = (o: Record<string, number> = {}) => ({ requests: 0, outputTokens: 0, usd: 0, subagents: 0, ...o });
const limits = { enabled: true, runRequests: 60, runOutputTokens: 400_000, runUsd: 5, sessionRequests: 400, sessionOutputTokens: 1_500_000, sessionUsd: 0, maxContinues: 3, maxSubagents: 6, bigPromptTokens: 2000 };
const view = (meter?: unknown) => ({ ...emptyView(), opened: '/h/p', state: { busy: true, verb: '', branch: 'main', engineLabel: 'Claude Code', demo: false, sessionId: 's', approvals: [], agents: [], tasks: [], limits: [{ name: 'five_hour', utilization: 0.3, resets_at: 1 }], settings: { permissionMode: 'default' }, sessions: [], items: [], ...(meter ? { meter } : {}) } }) as never;

describe('the side panel shows what this run has used so far', () => {
  it('says how much it has used and when it will pause', () => {
    render(<SessionPanel view={view({ enabled: true, run: counters({ requests: 12, outputTokens: 34_000, usd: 0.41, subagents: 2 }), session: counters(), limits, continues: 0, startedAt: 0 })} send={() => undefined} />);
    expect(screen.getByText('This run')).toBeTruthy(); expect(screen.getByTestId('run-used').textContent).toBe('This run has used 12 requests · 34.0k output tokens · $0.41 · 2 sub-agents so far.');
    expect(screen.getByText('It pauses and asks at 60 requests · 400.0k output tokens · $5.00.')).toBeTruthy();
  });
  it('says so when the run is paused, and when the guard is off; shows nothing before the first request', () => {
    const paused = { text: 'This run has made 60 requests to the model (the limit is 60).' };
    render(<SessionPanel view={view({ enabled: true, run: counters({ requests: 60 }), session: counters(), limits, continues: 0, startedAt: 0, paused })} send={() => undefined} />);
    expect(screen.getByText('paused')).toBeTruthy(); expect(screen.getByText(paused.text)).toBeTruthy(); cleanup();
    render(<SessionPanel view={view({ enabled: false, run: counters({ requests: 3 }), session: counters(), limits: { ...limits, enabled: false }, continues: 0, startedAt: 0 })} send={() => undefined} />);
    expect(screen.getByText('The budget guard is off.')).toBeTruthy(); cleanup();
    render(<SessionPanel view={view({ enabled: true, run: counters(), session: counters(), limits, continues: 0, startedAt: 0 })} send={() => undefined} />); expect(screen.queryByText('This run')).toBeNull();
  });
});
