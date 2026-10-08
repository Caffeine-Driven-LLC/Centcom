#!/usr/bin/env node
// Bundles apps/cli into one file so `centcom` starts in ~0.3 s instead of ~1.4 s (tsx otherwise transpiles the whole workspace on every launch).
// Every file keeps its own `import.meta.url`, so code that reads data files next to its source (animations, provider policy, the MCP script) still works.
// Usage: node tools/dev/bundle-cli.mjs <out.mjs>   (bin/centcom runs this when a source file is newer than the bundle)
import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = resolve(process.argv[2] ?? resolve(root, 'node_modules/.cache/centcom/cli.mjs'));
await mkdir(dirname(out), { recursive: true });
const stub = resolve(dirname(out), 'empty.mjs'); await writeFile(stub, 'export default {};\n'); // ink loads react-devtools-core only when DEV=true
const keepUrl = { name: 'keep-import-meta-url', setup(b) {
  b.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (a) => {
    if (a.path.includes('node_modules')) return; const src = await readFile(a.path, 'utf8'); if (!src.includes('import.meta.url')) return;
    return { contents: src.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(a.path).href)), loader: a.path.endsWith('x') ? (a.path.includes('.t') ? 'tsx' : 'jsx') : a.path.includes('.t') ? 'ts' : 'js' };
  });
} };
await build({
  entryPoints: [resolve(root, 'apps/cli/src/main.tsx')], outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', tsconfig: resolve(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"production"' }, alias: { 'react-devtools-core': stub }, external: ['@napi-rs/*'], plugins: [keepUrl], logLevel: 'warning', minifyWhitespace: true, minifySyntax: true, legalComments: 'none', absWorkingDir: root,
  banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
});
