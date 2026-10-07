#!/usr/bin/env node
/* Writes packages/agent/skills/manifest.json: the pack version and the size and sha256 of every SKILL.md. `--check` fails when it is out of date. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../packages/agent/skills/', import.meta.url)); const path = dir + 'manifest.json';
export function buildManifest(version) {
  const skills = {}; for (const n of readdirSync(dir).filter((x) => existsSync(dir + x + '/SKILL.md')).sort()) { const b = readFileSync(dir + n + '/SKILL.md'); skills[n] = { sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length }; }
  return { pack_version: version, skills };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let version = '1.0.0'; try { version = JSON.parse(readFileSync(path, 'utf8')).pack_version ?? version; } catch { /* first build */ }
  const text = JSON.stringify(buildManifest(version), null, 1) + '\n';
  if (process.argv.includes('--check')) { let cur = ''; try { cur = readFileSync(path, 'utf8'); } catch { /* missing */ } if (cur !== text) { console.error('skills manifest is out of date: run node tools/skills/build-manifest.mjs (and bump pack_version if a skill changed)'); process.exit(1); } console.log('skills manifest up to date'); }
  else { writeFileSync(path, text); console.log('wrote manifest'); }
}
