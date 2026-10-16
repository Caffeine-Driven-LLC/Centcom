import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AsyncQueue, parseInitializeModels } from '@centcom/agent';
import { AppController } from '../src/controller.js';
import { quickEntries } from '../src/palette/entries.js';

const models = parseInitializeModels(readFileSync(resolve(__dirname, '../../agent/test/fixtures/claude-initialize-2.1.301.jsonl'), 'utf8'))!;
const engine = { id: 'claude-code', provider: 'anthropic', label: 'Claude Code', capabilities: () => new Set(), start: async () => { throw new Error('unused'); } } as never;
function make(model: string, defaultEffort = 'medium') {
  const set: string[] = []; const c = new AppController({ engine, cwd: '/tmp', version: 't', skills: [], defaultEffort } as never);
  c.patch({ engineId: 'claude-code', settings: { ...c.state.settings, model } });
  (c as any).wantedEffort = defaultEffort;
  (c as any).adopt({ events: new AsyncQueue(), stop: async () => undefined, setEffort: (e: string) => set.push(e), setModel: () => undefined, listModels: async () => models, resumeToken: () => undefined });
  return { c, set };
}
const settle = () => new Promise((r) => setTimeout(r, 30));
const toasts = (c: AppController) => c.state.toasts.map((t) => t.text);

describe('effort follows the model', () => {
  it('the /effort list is the current model\'s, and a missing level is refused', async () => {
    const { c } = make('claude-sonnet-4-6'); await c.runCommand('/effort xhigh');
    expect(toasts(c).at(-1)).toBe('Effort is one of: low, medium, high, max (or default).'); expect(c.state.settings.effort ?? '').not.toBe('xhigh');
  });
  it('a model without effort has no effort control', async () => {
    const { c, set } = make('claude-haiku-4-5-20251001'); await c.runCommand('/effort high'); expect(toasts(c).at(-1)).toBe('This model has no effort setting.'); expect(set).not.toContain('high'); expect(c.effortProblem('high')).toBe('This model has no effort setting.');
  });
  it('the configured effort is shown only when the model takes it', async () => {
    const a = make('sonnet'); await (a.c as any).revalidateEffort(); expect(a.c.state.settings.effort).toBe('medium');
    const b = make('claude-haiku-4-5-20251001'); await (b.c as any).revalidateEffort(); expect(b.c.state.settings.effort ?? '').toBe(''); expect(b.set.at(-1) ?? '').toBe('');
  });
  it('switching model falls back to the closest level, with a notice, and comes back', async () => {
    const { c, set } = make('sonnet', 'xhigh'); await (c as any).revalidateEffort(); expect(c.state.settings.effort).toBe('xhigh');
    c.setModel('claude-opus-4-6'); await settle(); expect(c.state.settings.effort).toBe('high'); expect(set.at(-1)).toBe('high'); expect(JSON.stringify(c.state.items)).toContain('has no xhigh effort, so high is used');
    c.setModel('claude-haiku-4-5-20251001'); await settle(); expect(c.state.settings.effort ?? '').toBe(''); expect(set.at(-1)).toBe('');
    c.setModel('opus'); await settle(); expect(c.state.settings.effort).toBe('xhigh');
  });
  it('the palette offers only the levels of the model', () => { expect(quickEntries(['low', 'high']).filter((e) => e.cmd.startsWith('/effort')).map((e) => e.cmd)).toEqual(['/effort low', '/effort high']); expect(quickEntries([]).some((e) => e.cmd.startsWith('/effort'))).toBe(false); });
});
