/** How this copy was installed, from where its program file lives. Only a `standalone` install may replace itself. */
export type InstallMethod = 'standalone' | 'npm' | 'brew' | 'unknown';
export const UPDATE_COMMANDS = { npm: 'npm i -g @centcom/cli@latest', brew: 'brew upgrade centcom' } as const;
const METHODS: readonly string[] = ['standalone', 'npm', 'brew', 'unknown'];

/**
 * `CENTCOM_INSTALL_METHOD` is the build-time flag the packagers set (the Homebrew formula and the npm wrapper set it for their copies); it wins when it
 * is one of the four words. Otherwise the path decides: Homebrew's Cellar or prefix, a `node_modules` folder, or a program file called `centcom`
 * that is not `node` itself. A node running a source checkout is `unknown`.
 */
export function detectInstallMethod(execPath: string, env: NodeJS.ProcessEnv): InstallMethod {
  const flag = env.CENTCOM_INSTALL_METHOD; if (flag && METHODS.includes(flag)) return flag as InstallMethod;
  const p = execPath.replace(/\\/g, '/'); const base = (p.split('/').pop() ?? '').toLowerCase().replace(/\.exe$/, '');
  if (/\/(cellar|homebrew|linuxbrew)\//i.test(p)) return 'brew';
  if (/\/node_modules\//.test(p)) return 'npm';
  if (base === 'centcom') return 'standalone';
  return 'unknown';
}
/** The exact command to show for a method that must not replace itself. */
export const packageManagerCommand = (m: InstallMethod): string | undefined => (m === 'npm' ? UPDATE_COMMANDS.npm : m === 'brew' ? UPDATE_COMMANDS.brew : undefined);
/** The `update.auto` default: on for a standalone install, off for the rest. */
export const autoDefault = (m: InstallMethod): boolean => m === 'standalone';
