/** How this copy of Centcom was installed, so the right update command can be shown. */
export type InstallMethod = 'sea' | 'npm' | 'homebrew' | 'unknown';
export function detectInstallMethod(o: { execPath: string; scriptPath?: string; isSea?: boolean; platform?: NodeJS.Platform }): InstallMethod {
  if (o.isSea) return 'sea'; const p = (o.scriptPath ?? '').replace(/\\/g, '/'); const e = o.execPath.replace(/\\/g, '/');
  if (/\/(Cellar|homebrew)\//i.test(p) || /\/(Cellar|homebrew)\//i.test(e)) return 'homebrew'; if (/\/node_modules\//.test(p)) return 'npm'; return 'unknown';
}
export const updateCommand = (m: InstallMethod): string | undefined => (m === 'homebrew' ? 'brew upgrade centcom' : m === 'npm' ? 'npm install --global centcom@latest' : undefined);
