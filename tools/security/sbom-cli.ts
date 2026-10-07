/** `pnpm sbom --artifact <path> --out <file.cdx.json> [--importer apps/cli] [--name n] [--version v]`: a CycloneDX 1.5 SBOM for one release artifact. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readLock } from './lockfile.js';
import { artifactName, buildSbom, sbomProblems, sha256Of, validateSbom } from './sbom.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function main(argv: string[], log: (l: string) => void = console.log): number {
  const { values } = parseArgs({ args: argv, options: { artifact: { type: 'string' }, out: { type: 'string' }, importer: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' } } });
  if (!values.artifact || !values.out) { console.error('usage: pnpm sbom --artifact <path> --out <file.cdx.json> [--importer apps/cli] [--name n] [--version v]'); return 2; }
  let sha: string; try { sha = sha256Of(values.artifact); } catch { console.error('the artifact could not be read'); return 1; }
  const pkg = JSON.parse(readFileSync(join(root, 'apps/cli/package.json'), 'utf8')) as { version: string };
  const bom = buildSbom({ lock: readLock(root), importer: values.importer ?? 'apps/cli', name: values.name ?? artifactName(values.artifact), version: values.version ?? pkg.version, nodeVersion: process.versions.node, artifactSha256: sha });
  const v = validateSbom(bom); const p = sbomProblems(bom as never, process.versions.node); if (!v.ok || p.length) { console.error(`the SBOM is not valid: ${[...v.errors, ...p].join('; ')}`); return 1; }
  writeFileSync(values.out, JSON.stringify(bom, null, 2) + '\n'); log(`wrote ${values.out}`); return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
