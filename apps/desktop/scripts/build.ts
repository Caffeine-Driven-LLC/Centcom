/** Bundles the main process (an ES module: the terminal engine libraries use top-level await) and the preload (CommonJS, as a sandboxed preload must be) into dist/. Electron, the OS keychain binding and the React devtools hook stay external. */
import { build, type Plugin } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/** Library code finds its data files (verbs.txt, animations.json, the Claude permission bridge) relative to `import.meta.url`. Bundled into one file that would point at dist/, so each use is pinned to the source file's own location. Development runs from the checkout; a packaged app has to ship those files (lane C094). */
const pinSourceUrls: Plugin = { name: 'pin-source-urls', setup(b) { b.onLoad({ filter: /[\\/]packages[\\/][^\\/]+[\\/]src[\\/].*\.tsx?$/ }, (a) => { const text = readFileSync(a.path, 'utf8'); if (!text.includes('import.meta.url')) return undefined; return { contents: text.split('import.meta.url').join(JSON.stringify(pathToFileURL(a.path).href)), loader: a.path.endsWith('x') ? 'tsx' : 'ts' }; }); } };
const EXTERNAL = ['electron', '@napi-rs/keyring'];
const BANNER = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);";
export async function bundle(root: string, outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  await build({ entryPoints: [join(root, 'src/main.ts')], outfile: join(outDir, 'main.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22', plugins: [pinSourceUrls], external: EXTERNAL, alias: { 'react-devtools-core': join(root, 'src/local/empty.ts') }, banner: { js: BANNER }, sourcemap: false, logLevel: 'silent' });
  await build({ entryPoints: [join(root, 'src/preload.ts')], outfile: join(outDir, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: false, logLevel: 'silent' });
  return [join(outDir, 'main.mjs'), join(outDir, 'preload.cjs')];
}
if (process.argv[1]?.endsWith('build.ts')) { const root = new URL('..', import.meta.url).pathname; await bundle(root, join(root, 'dist')); console.log('built apps/desktop/dist'); }
