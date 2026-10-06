#!/usr/bin/env node
// Build metadata (C012): writes dist/build-meta.json with the product version for a channel, the contract
// version it was built against (CT-VER), the commit, the build time and the Node version.
// It must never record hostnames, usernames or absolute paths, and never stamp an unknown contract version.
//
// Usage: node tools/release/build-meta.mjs [--channel stable|beta|nightly] [--out dist/build-meta.json]
//          [--now <RFC 3339>] [--beta-number N] [--commit <40 hex>] [--root <repo>]
// Exit codes: 0 written, 2 usage error or unreadable input (nothing written).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const CHANNELS = Object.freeze(['stable', 'beta', 'nightly']);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SEMVER_CORE = /^\d+\.\d+\.\d+$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const COMMIT = /^[0-9a-f]{40}$/;

/** A failure with the exit code the CLI should use. */
export class ReleaseError extends Error {
  constructor(message, code = 2) { super(message); this.name = 'ReleaseError'; this.code = code; }
}

/** Reads `contract_version` from contracts/index.json; throws (exit 2) if it is missing or unreadable. */
export function readContractVersion(root) {
  let index;
  try { index = JSON.parse(readFileSync(join(root, 'contracts/index.json'), 'utf8')); }
  catch { throw new ReleaseError('contracts/index.json is unreadable; refusing to stamp an unknown contract version'); }
  const v = index && typeof index === 'object' ? index.contract_version : undefined;
  if (typeof v !== 'string' || !SEMVER.test(v)) throw new ReleaseError('contracts/index.json has no valid contract_version');
  return v;
}

/**
 * The single product version: every @centcom/* package under packages/ and apps/ shares one version
 * (the Changesets fixed group). Throws (exit 2) if they disagree or none are found.
 */
export function productVersion(root) {
  const versions = new Map();
  for (const group of ['packages', 'apps']) {
    let names = [];
    try { names = readdirSync(join(root, group)); } catch { continue; }
    for (const name of names.sort()) {
      let pkg;
      try { pkg = JSON.parse(readFileSync(join(root, group, name, 'package.json'), 'utf8')); } catch { continue; }
      if (typeof pkg?.name === 'string' && pkg.name.startsWith('@centcom/')) versions.set(pkg.name, pkg.version);
    }
  }
  const distinct = [...new Set(versions.values())];
  if (distinct.length === 0) throw new ReleaseError('no @centcom/* packages found');
  if (distinct.length > 1) throw new ReleaseError(`@centcom/* packages disagree on the version (${distinct.join(', ')}); the fixed group must share one`);
  const v = distinct[0];
  if (typeof v !== 'string' || !SEMVER_CORE.test(v)) throw new ReleaseError('the product version must be plain x.y.z');
  return v;
}

/** UTC calendar day of `now` as YYYYMMDD. */
export const utcDay = (now) => now.toISOString().slice(0, 10).replaceAll('-', '');

/**
 * The version for a channel: stable `x.y.z`, beta `x.y.z-beta.N`, nightly `x.y.z-nightly.YYYYMMDD` (UTC).
 * @param {string} base plain x.y.z
 * @param {'stable'|'beta'|'nightly'} channel
 * @param {{ now: Date, betaNumber?: number }} opts
 */
export function channelVersion(base, channel, { now, betaNumber = 1 }) {
  if (!SEMVER_CORE.test(base)) throw new ReleaseError('base version must be plain x.y.z');
  if (channel === 'stable') return base;
  if (channel === 'beta') {
    if (!Number.isSafeInteger(betaNumber) || betaNumber < 0) throw new ReleaseError('beta number must be a non-negative integer');
    return `${base}-beta.${betaNumber}`;
  }
  if (channel === 'nightly') return `${base}-nightly.${utcDay(now)}`;
  throw new ReleaseError(`unknown channel (expected ${CHANNELS.join('|')})`);
}

/** The commit hash from an explicit value, GITHUB_SHA, or `git rev-parse HEAD`; 'unknown' when none is valid. */
export function resolveCommit(root, explicit, env = process.env) {
  for (const c of [explicit, env.GITHUB_SHA]) if (typeof c === 'string' && COMMIT.test(c)) return c;
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (COMMIT.test(out)) return out;
  } catch { /* not a git checkout: fall through */ }
  return 'unknown';
}

/**
 * Builds the metadata object. Only these six fields; nothing machine- or user-specific.
 * @param {{ root: string, channel: string, now: Date, betaNumber?: number, commit?: string, node?: string, env?: NodeJS.ProcessEnv }} o
 */
export function buildMeta(o) {
  if (!CHANNELS.includes(o.channel)) throw new ReleaseError(`unknown channel (expected ${CHANNELS.join('|')})`);
  if (!(o.now instanceof Date) || Number.isNaN(o.now.getTime())) throw new ReleaseError('invalid build time');
  const contract_version = readContractVersion(o.root);
  const version = channelVersion(productVersion(o.root), o.channel, { now: o.now, betaNumber: o.betaNumber });
  return { version, contract_version, commit: resolveCommit(o.root, o.commit, o.env), built_at: o.now.toISOString(), channel: o.channel, node: o.node ?? process.versions.node };
}

/** Build time from --now, else SOURCE_DATE_EPOCH (seconds), else the wall clock. */
export function resolveNow(flag, env = process.env, clock = () => new Date()) {
  if (flag !== undefined) {
    const d = new Date(flag);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(flag) || Number.isNaN(d.getTime())) throw new ReleaseError('--now must be an RFC 3339 timestamp');
    return d;
  }
  if (env.SOURCE_DATE_EPOCH !== undefined && env.SOURCE_DATE_EPOCH !== '') {
    if (!/^\d+$/.test(env.SOURCE_DATE_EPOCH)) throw new ReleaseError('SOURCE_DATE_EPOCH must be whole seconds');
    return new Date(Number(env.SOURCE_DATE_EPOCH) * 1000);
  }
  return clock();
}

/** Writes JSON through a temp file and a rename so readers never see half a file. */
export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

/** CLI entrypoint; returns the exit code. */
export function main(argv = process.argv.slice(2), env = process.env) {
  try {
    let values;
    try {
      ({ values } = parseArgs({ args: argv, options: { channel: { type: 'string', default: 'nightly' }, out: { type: 'string' }, now: { type: 'string' }, 'beta-number': { type: 'string' }, commit: { type: 'string' }, root: { type: 'string' } }, strict: true }));
    } catch (e) { throw new ReleaseError(`usage: ${e.message}`); }
    const root = values.root ? resolve(values.root) : REPO_ROOT;
    const betaRaw = values['beta-number'] ?? env.GITHUB_RUN_NUMBER;
    if (betaRaw !== undefined && !/^\d+$/.test(betaRaw)) throw new ReleaseError('--beta-number must be a non-negative integer');
    const meta = buildMeta({ root, channel: values.channel, now: resolveNow(values.now, env), betaNumber: betaRaw === undefined ? 1 : Number(betaRaw), commit: values.commit, env });
    writeJsonAtomic(values.out ? resolve(values.out) : join(root, 'dist/build-meta.json'), meta);
    process.stdout.write(`build-meta: ${meta.version} (${meta.channel}, contract ${meta.contract_version})\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`build-meta: ${e instanceof ReleaseError ? e.message : 'unexpected failure'}\n`);
    return e instanceof ReleaseError ? e.code : 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
