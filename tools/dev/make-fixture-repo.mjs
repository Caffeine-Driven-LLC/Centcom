#!/usr/bin/env node
/* `node tools/dev/make-fixture-repo.mjs <dir> [--branches n] [--dirty]`: a tiny git repo with fixed authors and dates, so the same flags always give the same commit hashes. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function makeFixtureRepo(dir, { branches = 0, dirty = false } = {}) {
  const root = resolve(dir); mkdirSync(root, { recursive: true }); if (readdirSync(root).length) throw new Error(`${root} is not empty`);
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const git = (...a) => execFileSync('git', a, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const commit = (msg, day) => { const d = `2026-01-0${day}T12:00:00+0000`; execFileSync('git', ['commit', '-q', '-m', msg], { cwd: root, env: { ...env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d } }); };
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), '# Fixture\n\nA tiny project for tests.\n'); git('add', '.'); commit('Add readme', 1);
  mkdirSync(join(root, 'src')); writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n'); writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 2;\n'); git('add', '.'); commit('Add sources', 2);
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\nexport const sum = (x: number, y: number) => x + y;\n'); git('add', '.'); commit('Add sum', 3);
  for (let i = 1; i <= branches; i++) git('branch', `feature/${i}`);
  if (dirty) writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 2;\n// unsaved work\n');
  return root;
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const a = process.argv.slice(2); const dir = a.find((x) => !x.startsWith('--') && a[a.indexOf(x) - 1] !== '--branches');
  if (!dir) { console.error('Usage: node tools/dev/make-fixture-repo.mjs <dir> [--branches n] [--dirty]'); process.exit(2); }
  const bi = a.indexOf('--branches'); const branches = bi >= 0 ? Number(a[bi + 1]) : 0; if (!Number.isInteger(branches) || branches < 0 || branches > 50) { console.error('--branches must be 0 to 50'); process.exit(2); }
  try { console.log(makeFixtureRepo(dir, { branches, dirty: a.includes('--dirty') })); } catch (e) { console.error(String(e.message ?? e)); process.exit(1); }
}
