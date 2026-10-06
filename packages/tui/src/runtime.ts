/** The pieces every front end (terminal, print mode, web) gives the controller: the permission policy with saved rules, checkpoints and context settings. */
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { FileTrustStore, createPermissionEngine, createRiskClassifier, createRuleStore, nodePermFs, type PermissionEngine } from '@centcom/agent';
import { defaultDeps, userConfigPath } from '@centcom/config';
import type { ControllerOptions } from './controller.js';
import type { AppController } from './controller.js';

export interface RuntimeOptions {
  cwd: string; engineId: string; demo: boolean;
  /** Started with --dangerously-skip-permissions: the `bypass` mode may be used (hard denies still apply). */ dangerous?: boolean;
  /** No one can answer an approval (print mode): anything that would ask is denied. */ headless?: boolean;
  /** Where permissions.json and trust.json live; defaults to the user config folder. */ configDir?: string; home?: string;
  checkpoints?: boolean;
}
export interface Runtime { options: Pick<ControllerOptions, 'policy' | 'checkpoints'>; /** Connect the controller once it exists: approvals are shown by it. */ bind(ctl: AppController): void; warnings: string[] }

export async function buildRuntime(o: RuntimeOptions): Promise<Runtime> {
  if (o.demo) return { options: {}, bind: () => undefined, warnings: [] }; // the demo engine keeps its simple built-in rules
  const home = o.home ?? homedir(); const dir = o.configDir ?? dirname(userConfigPath(defaultDeps({ homedir: home }))); let ctl: AppController | undefined;
  const clock = { now: () => Date.now(), setTimeout: (f: () => void, ms: number) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimeout: (h: never) => clearTimeout(h as NodeJS.Timeout) };
  const rules = createRuleStore({ fs: nodePermFs, clock, trust: new FileTrustStore(join(dir, 'trust.json')), userRulesPath: join(dir, 'permissions.json') });
  const rc = createRiskClassifier({ root: o.cwd, cwd: o.cwd, home, platform: process.platform === 'win32' ? 'win32' : 'posix' });
  const engine: PermissionEngine = createPermissionEngine({ fs: nodePermFs, clock, rules, classifier: { classify: (r) => rc.classify(r).risk },
    prompter: { prompt: (p, signal) => (ctl ? ctl.promptApproval(p, signal) : Promise.resolve({ decision: 'deny', scope: 'once', reason: 'no_ui' })) },
    config: { home, userRulesPath: join(dir, 'permissions.json'), bypassEnabled: !!o.dangerous, headless: !!o.headless, os: process.platform === 'win32' ? 'win32' : 'posix' } });
  const warnings: string[] = [];
  await rules.loadUser().catch(() => warnings.push('Your saved permission rules could not be read, so none are used.'));
  const proj = await rules.loadProject(o.cwd).catch(() => ({ loaded: false, needsTrust: false })); if (proj.needsTrust) warnings.push('This project has its own permission rules file. It is not used until you type /trust rules.');
  warnings.push(...rules.warnings());
  return { options: { policy: { engine, root: o.cwd }, ...(o.checkpoints === false ? {} : { checkpoints: {} }) }, bind: (c) => { ctl = c; }, warnings };
}
