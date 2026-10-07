/** Bundles the main process and the preload into dist/ (CommonJS: Electron loads them with require). Electron itself stays external. */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function bundle(root: string, outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true }); const out: string[] = [];
  for (const [entry, file] of [['src/main.ts', 'main.cjs'], ['src/preload.ts', 'preload.cjs']] as const) { await build({ entryPoints: [join(root, entry)], outfile: join(outDir, file), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false, logLevel: 'silent' }); out.push(join(outDir, file)); }
  return out;
}
if (process.argv[1]?.endsWith('build.ts')) { const root = new URL('..', import.meta.url).pathname; await bundle(root, join(root, 'dist')); console.log('built apps/desktop/dist'); }
