export type EngineName = 'claude-code' | 'codex';
export interface Pick { engine: EngineName | 'demo'; note: string }
const NAME: Record<EngineName, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
const INSTALL: Record<EngineName, string> = { 'claude-code': 'Install Claude Code and sign in to use the real one.', codex: 'Install Codex (npm i -g @openai/codex) and run `codex login`.' };
/**
 * Which agent to start. `--demo` or `--engine demo` is the demo. Otherwise the wanted one (`--engine`, else the remembered choice, else Claude Code);
 * if it is not installed but the other one is, use the other and say so (it is not remembered); only when neither is installed is it the demo.
 */
export async function chooseEngine(o: { demo: boolean; explicit?: EngineName; preferred?: EngineName; installed(e: EngineName): Promise<boolean>; /** The service has switched this agent off (a kill switch): it is not used, and the reason is said. */ blocked?(e: EngineName): boolean }): Promise<Pick> {
  if (o.demo) return { engine: 'demo', note: '' };
  const want = o.explicit ?? o.preferred ?? 'claude-code'; const other: EngineName = want === 'codex' ? 'claude-code' : 'codex';
  const off = (e: EngineName) => !!o.blocked?.(e); const ok = async (e: EngineName) => !off(e) && (await o.installed(e));
  if (await ok(want)) return { engine: want, note: '' };
  const why = off(want) ? `${NAME[want]} has been switched off by Centcom for now` : `${NAME[want]} was not found`; const fix = off(want) ? 'It comes back by itself when it is switched on again.' : INSTALL[want];
  if (!o.explicit && (await ok(other))) return { engine: other, note: `${why}, so this session uses ${NAME[other]}. ${fix}` };
  return { engine: 'demo', note: `${why}, so this is the demo agent. ${fix}` };
}
