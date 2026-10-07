/** Bundles the main process (an ES module: the terminal engine libraries use top-level await) and the preload (CommonJS, as a sandboxed preload must be) into dist/. Electron, the OS keychain binding and the React devtools hook stay external. */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const EXTERNAL = ['electron', '@napi-rs/keyring'];
const BANNER = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);";
export async function bundle(root: string, outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  await build({ entryPoints: [join(root, 'src/main.ts')], outfile: join(outDir, 'main.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', external: EXTERNAL, alias: { 'react-devtools-core': join(root, 'src/local/empty.ts') }, banner: { js: BANNER }, sourcemap: false, logLevel: 'silent' });
  await build({ entryPoints: [join(root, 'src/preload.ts')], outfile: join(outDir, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false, logLevel: 'silent' });
  return [join(outDir, 'main.mjs'), join(outDir, 'preload.cjs')];
}
if (process.argv[1]?.endsWith('build.ts')) { const root = new URL('..', import.meta.url).pathname; await bundle(root, join(root, 'dist')); console.log('built apps/desktop/dist'); }
