/** CycloneDX 1.5 SBOM from the lockfile: every production dependency reachable from an importer, with purl and SHA-512 hash, plus the Node runtime. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import Ajv from 'ajv';
import type { Lock } from './lockfile.js';

export interface Component { type: string; 'bom-ref': string; name: string; version: string; purl: string; hashes?: { alg: string; content: string }[]; scope?: string }
export const purl = (name: string, version: string): string => `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`;
const split = (key: string): { name: string; version: string } => { const k = key.replace(/\(.*$/, ''); const i = k.lastIndexOf('@'); return { name: k.slice(0, i), version: k.slice(i + 1) }; };
const hex = (integrity: string): { alg: string; content: string } | undefined => { const m = /^sha(256|384|512)-(.+)$/.exec(integrity); return m ? { alg: `SHA-${m[1]}`, content: Buffer.from(m[2]!, 'base64').toString('hex') } : undefined; };

/** Production closure of one importer (e.g. `apps/cli`), following snapshot dependencies. Workspace packages are followed, not listed. */
export function closure(lock: Lock, importer: string): Component[] {
  const imp = lock.importers[importer]; if (!imp) throw new Error(`unknown importer ${importer}`); const seen = new Map<string, Component>(); const queue: string[] = []; const work: string[] = [];
  const enter = (importerPath: string): void => { if (work.includes(importerPath)) return; work.push(importerPath); for (const [n, d] of Object.entries(lock.importers[importerPath]?.dependencies ?? {})) { if (d.version.startsWith('link:')) { enter(d.version.slice(5).replace(/^(\.\.\/)+/, '')); continue; } queue.push(`${n}@${d.version}`); } };
  enter(importer);
  while (queue.length) {
    const key = queue.pop()!; const bare = key.replace(/\(.*$/, ''); if (seen.has(key)) continue; const { name, version } = split(key); const pkg = lock.packages[bare]; const h = pkg?.resolution?.integrity ? hex(pkg.resolution.integrity) : undefined;
    seen.set(key, { type: 'library', 'bom-ref': purl(name, version), name, version, purl: purl(name, version), ...(h ? { hashes: [h] } : {}), scope: 'required' });
    const snap = lock.snapshots[key]; for (const [n, v] of Object.entries({ ...snap?.dependencies, ...snap?.optionalDependencies })) queue.push(`${n}@${v}`);
  }
  const byRef = new Map<string, Component>(); for (const c of seen.values()) byRef.set(c['bom-ref'], c); return [...byRef.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}
export interface SbomInput { lock: Lock; importer: string; name: string; version: string; nodeVersion: string; artifactSha256?: string; now?: Date; serial?: string; licences?: Record<string, string> }
export function buildSbom(i: SbomInput): Record<string, unknown> {
  const comps = closure(i.lock, i.importer).map((c) => (i.licences?.[`${c.name}@${c.version}`] ? { ...c, licenses: [{ expression: i.licences[`${c.name}@${c.version}`] }] } : c));
  const node = { type: 'platform', 'bom-ref': `pkg:generic/node@${i.nodeVersion}`, name: 'node', version: i.nodeVersion, purl: `pkg:generic/node@${i.nodeVersion}` };
  return { bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${i.serial ?? randomUUID()}`, version: 1,
    metadata: { timestamp: (i.now ?? new Date()).toISOString(), tools: { components: [{ type: 'application', name: 'centcom-security-sbom', version: '1' }] }, component: { type: 'application', 'bom-ref': `pkg:generic/${i.name}@${i.version}`, name: i.name, version: i.version, ...(i.artifactSha256 ? { hashes: [{ alg: 'SHA-256', content: i.artifactSha256 }] } : {}) } },
    components: [node, ...comps], dependencies: [{ ref: `pkg:generic/${i.name}@${i.version}`, dependsOn: [node['bom-ref'], ...comps.map((c) => c['bom-ref'])] }] };
}
const SCHEMA = JSON.parse(readFileSync(new URL('./cyclonedx-1.5.subset.schema.json', import.meta.url), 'utf8')) as object;
const ajv = new Ajv({ allErrors: true, strict: false }); const validate = ajv.compile(SCHEMA);
export function validateSbom(b: unknown): { ok: boolean; errors: string[] } { const ok = validate(b) as boolean; return { ok, errors: ok ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`) }; }
/** Every bundled library has a purl and a hash, and the runtime is named with its exact version. */
export function sbomProblems(b: { components?: Component[] }, nodeVersion: string): string[] {
  const p: string[] = []; const cs = b.components ?? []; if (!cs.some((c) => c.name === 'node' && c.version === nodeVersion)) p.push(`no node ${nodeVersion} component`);
  for (const c of cs) if (c.type === 'library' && (!c.purl || !c.hashes?.length)) p.push(`${c.name}@${c.version} has no ${!c.purl ? 'purl' : 'hash'}`); if (!cs.some((c) => c.type === 'library')) p.push('no libraries listed'); return p;
}
export const sha256Of = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
export const artifactName = (path: string): string => basename(path).replace(/\.[^.]*$/, '');
