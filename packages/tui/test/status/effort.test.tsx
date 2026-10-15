import { describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { AppController } from '../../src/index.js';
import { layoutStatus, renderStatus, statusFieldsFor } from '../../src/status/index.js';

const mk = () => new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: '/tmp', branch: 'main', version: 't', skills: [] });
const header = (c: AppController) => renderStatus(layoutStatus(statusFieldsFor(c.state), 160, undefined, 'header'), 160);

describe('the model and effort a turn runs on are always in the status line', () => {
  it('shows the model the engine reported and the effort for Claude Code, and no effort for another engine', () => {
    const c = mk(); const me = c.state.agents[0]!;
    c.patch({ engineId: 'claude-code', engineLabel: 'Claude Code', agents: [{ ...me, model: 'claude-sonnet-5-5' }], settings: { ...c.state.settings, effort: 'medium' } });
    expect(header(c)).toContain('claude-sonnet-5-5'); expect(header(c)).toContain('medium');
    c.patch({ engineId: 'codex', engineLabel: 'Codex' }); expect(header(c)).not.toContain('medium'); c.stop();
  });
});
