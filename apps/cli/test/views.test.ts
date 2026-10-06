import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DemoEngine } from '@centcom/agent';
import { AppController } from '@centcom/tui';
import { appViews } from '../src/views.js';

const dirs: string[] = []; afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const proj = () => { const d = mkdtempSync(join(tmpdir(), 'centcom-views-')); dirs.push(d); mkdirSync(join(d, '.claude')); writeFileSync(join(d, '.claude/settings.json'), '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo done"}]}]}}'); writeFileSync(join(d, '.mcp.json'), '{"mcpServers":{"files":{"type":"stdio","command":"npx","args":["-y","x"]}}}'); return d; };
describe('in-app views', () => {
  it('show the same lists as the terminal commands', async () => { const d = proj(); const v = appViews(d); expect((await v.mcp!([])).join('\n')).toContain('files'); expect((await v.hooks!(['list'])).join('\n')).toContain('echo done'); expect((await v.memory!(['status'])).length).toBeGreaterThan(0); });
  it('never change anything: write subcommands are refused with the terminal command to use', async () => { const d = proj(); const v = appViews(d); for (const [name, args] of [['mcp', ['add', 'x', '--cmd', 'y']], ['hooks', ['add', '--event', 'Stop', '--cmd', 'rm -rf /']], ['memory', ['add', 'note']]] as const) { const out = (await v[name]!([...args])).join('\n'); expect(out).toMatch(/only shows/); expect(out).toMatch(/in a terminal/); } });
  it('the app shows a view as a notice, and says when there is none', async () => { const d = proj(); const ctl = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: d, version: 't', skills: [], views: appViews(d) }); await ctl.runCommand('/hooks'); const n = ctl.state.items.at(-1)!; expect(n.kind === 'notice' && `${n.text}\n${n.detail}`).toContain('echo done'); const bare = new AppController({ engine: new DemoEngine({ speed: 100 }), demo: true, cwd: d, version: 't', skills: [] }); await bare.runCommand('/mcp'); expect(bare.state.toasts.at(-1)!.text).toMatch(/centcom mcp/); ctl.stop(); bare.stop(); });
});
