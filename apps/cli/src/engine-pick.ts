export type EngineName = 'claude-code' | 'codex';
export interface Pick { engine: EngineName | 'demo'; note: string }
const NAME: Record<EngineName, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };
const INSTALL: Record<EngineName, string> = { 'claude-code': 'Install Claude Code and sign in to use the real one.', codex: 'Install Codex (npm i -g @openai/codex) and run `codex login`.' };
/**
 * Which agent to start. `--demo` or `--engine demo` is the demo. Otherwise the wanted one (`--engine`, else the remembered choice, else Claude Code);
 * if it is not installed but the other one is, use the other and say so (it is not remembered); only when neither is installed is it the demo.
 */
export async function chooseEngine(o: { demo: boolean; explicit?: EngineName; preferred?: EngineName; installed(e: EngineName): Promise<boolean> }): Promise<Pick> {
  if (o.demo) return { engine: 'demo', note: '' };
  const want = o.explicit ?? o.preferred ?? 'claude-code'; const other: EngineName = want === 'codex' ? 'claude-code' : 'codex';
  if (await o.installed(want)) return { engine: want, note: '' };
  if (!o.explicit && (await o.installed(other))) return { engine: other, note: `${NAME[want]} was not found, so this session uses ${NAME[other]}. ${INSTALL[want]}` };
  return { engine: 'demo', note: `${NAME[want]} was not found, so this is the demo agent. ${INSTALL[want]}` };
}
