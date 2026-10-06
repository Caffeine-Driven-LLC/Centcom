#!/usr/bin/env node
// Release manifest (C012): assembles the CT-API-RELEASES manifest (contracts/schemas/release-manifest.schema.json)
// from a directory of signed artifacts and the build metadata. Dry run only: URLs are placeholders, nothing is
// uploaded. It must list exactly the supported platform/arch pairs and never emit fields outside the schema.
//
// Artifacts are named `centcom-<platform>-<arch>[.<ext>]` with a `<name>.sig` next to each (from sign.mjs).
// Usage: node tools/release/manifest.mjs --channel C --dir artifacts/ --out manifest.json
//          [--meta dist/build-meta.json] [--pub release.pub] [--base-url URL] [--min-supported x.y.z]
//          [--now <RFC 3339>] [--sig-kid ID] [--notes-url URL]
// Exit codes: 0 written, 1 missing/duplicate/unsigned/bad artifact, 2 usage or unreadable input.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CHANNELS, ReleaseError, resolveNow, writeJsonAtomic } from './build-meta.mjs';
import { decodeSig, loadPublicKey, SignError, verifyDigest } from './sign.mjs';

/** The platform/arch pairs every release ships, in the deterministic manifest order (byte order of `platform-arch`). */
export const TARGETS = Object.freeze(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']);
export const DEFAULT_BASE_URL = 'https://downloads.centcom.invalid/releases';
const NAME = /^centcom-(linux|darwin|win32)-(x64|arm64)(\.[A-Za-z0-9][A-Za-z0-9.]*)?$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** Kind from the file extension: .tgz is an npm tarball, other archives are archives, anything else a binary. */
export function kindOf(name) {
  if (name.endsWith('.tgz')) return 'npm';
  if (/\.(zip|tar\.gz|tar\.xz|tar\.zst)$/.test(name)) return 'archive';
  return 'binary';
}

/**
 * Finds artifacts in `dir`. Returns one entry per platform/arch, sorted; throws ReleaseError(1) naming every
 * missing or duplicated pair. Files that do not match the naming rule are ignored.
 */
export function scanArtifacts(dir) {
  let names;
  try { names = readdirSync(dir); } catch { throw new ReleaseError('artifacts directory is unreadable'); }
  const byTarget = new Map();
  const dupes = new Set();
  for (const name of names.sort()) {
    if (name.endsWith('.sig')) continue;
    const m = NAME.exec(name);
    if (!m) continue;
    const target = `${m[1]}-${m[2]}`;
    if (!TARGETS.includes(target)) continue;
    if (byTarget.has(target)) dupes.add(target);
    byTarget.set(target, { name, platform: m[1], arch: m[2], path: join(dir, name) });
  }
  const missing = TARGETS.filter((t) => !byTarget.has(t));
  const problems = [];
  if (missing.length) problems.push(`missing platform/arch: ${missing.join(', ')}`);
  if (dupes.size) problems.push(`more than one artifact for: ${[...dupes].sort().join(', ')}`);
  if (problems.length) throw new ReleaseError(problems.join('; '), 1);
  return TARGETS.map((t) => byTarget.get(t));
}

/** Reads and checks build-meta.json (version, contract_version, channel). */
export function readMeta(path) {
  let meta;
  try { meta = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new ReleaseError('build metadata is unreadable (run build-meta.mjs first)'); }
  if (!meta || typeof meta !== 'object') throw new ReleaseError('build metadata is not an object');
  if (typeof meta.version !== 'string' || !SEMVER.test(meta.version)) throw new ReleaseError('build metadata has no valid version');
  if (typeof meta.contract_version !== 'string' || !SEMVER.test(meta.contract_version)) throw new ReleaseError('build metadata has no valid contract_version');
  if (!CHANNELS.includes(meta.channel)) throw new ReleaseError('build metadata has no valid channel');
  return meta;
}

/**
 * Builds the manifest object. Every artifact must be non-empty and carry a well-formed signature; when a
 * public key is given each signature is verified against the file digest before it is listed.
 * @param {{ channel: string, dir: string, meta: { version: string, contract_version: string, channel: string },
 *   now: Date, publicKey?: import('node:crypto').KeyObject, baseUrl?: string, minSupported?: string, sigKid?: string, notesUrl?: string }} o
 */
export function buildManifest(o) {
  if (!CHANNELS.includes(o.channel)) throw new ReleaseError(`unknown channel (expected ${CHANNELS.join('|')})`);
  if (o.meta.channel !== o.channel) throw new ReleaseError(`build metadata is for channel ${o.meta.channel}, not ${o.channel}`);
  const minSupported = o.minSupported ?? '0.0.0';
  if (!SEMVER.test(minSupported)) throw new ReleaseError('--min-supported must be a version');
  const base = (o.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  try { new URL(base); } catch { throw new ReleaseError('--base-url must be an absolute URL'); }
  const bad = [];
  const artifacts = [];
  for (const a of scanArtifacts(o.dir)) {
    const bytes = readFileSync(a.path);
    if (bytes.length < 1) { bad.push(`${a.platform}-${a.arch}: empty file`); continue; }
    let sigText;
    try { sigText = readFileSync(`${a.path}.sig`, 'utf8').trim(); } catch { bad.push(`${a.platform}-${a.arch}: no .sig file`); continue; }
    if (!decodeSig(sigText)) { bad.push(`${a.platform}-${a.arch}: malformed signature`); continue; }
    const digest = createHash('sha256').update(bytes).digest();
    if (o.publicKey && !verifyDigest(digest, sigText, o.publicKey)) { bad.push(`${a.platform}-${a.arch}: signature does not verify`); continue; }
    const entry = { platform: a.platform, arch: a.arch, kind: kindOf(a.name), url: `${base}/${o.channel}/${o.meta.version}/${encodeURIComponent(a.name)}`, sha256: digest.toString('hex'), size: bytes.length, sig: sigText };
    if (o.sigKid) entry.sig_kid = o.sigKid;
    artifacts.push(entry);
  }
  if (bad.length) throw new ReleaseError(bad.join('; '), 1);
  const manifest = { channel: o.channel, version: o.meta.version, released_at: o.now.toISOString(), min_supported: minSupported, contract_version: o.meta.contract_version };
  if (o.notesUrl) {
    try { new URL(o.notesUrl); } catch { throw new ReleaseError('--notes-url must be an absolute URL'); }
    manifest.notes_url = o.notesUrl;
  }
  manifest.artifacts = artifacts;
  return manifest;
}

/** CLI entrypoint; returns the exit code. */
export function main(argv = process.argv.slice(2), env = process.env) {
  try {
    let values;
    try {
      ({ values } = parseArgs({ args: argv, options: { channel: { type: 'string' }, dir: { type: 'string' }, out: { type: 'string' }, meta: { type: 'string', default: 'dist/build-meta.json' }, pub: { type: 'string' }, 'base-url': { type: 'string' }, 'min-supported': { type: 'string' }, now: { type: 'string' }, 'sig-kid': { type: 'string' }, 'notes-url': { type: 'string' } }, strict: true }));
    } catch (e) { throw new ReleaseError(`usage: ${e.message}`); }
    if (!values.channel || !values.dir || !values.out) throw new ReleaseError('usage: manifest.mjs --channel C --dir artifacts/ --out manifest.json');
    let publicKey;
    try { publicKey = values.pub ? loadPublicKey(values.pub) : undefined; } catch (e) { throw new ReleaseError(e instanceof SignError ? e.message : 'public key is unreadable'); }
    if (!publicKey) process.stderr.write('manifest: no --pub given; signatures are checked for shape only, not verified\n');
    const manifest = buildManifest({ channel: values.channel, dir: resolve(values.dir), meta: readMeta(resolve(values.meta)), now: resolveNow(values.now, env), publicKey, baseUrl: values['base-url'], minSupported: values['min-supported'], sigKid: values['sig-kid'], notesUrl: values['notes-url'] });
    const out = resolve(values.out);
    try { if (statSync(out).isDirectory()) throw new ReleaseError('--out is a directory'); } catch (e) { if (e instanceof ReleaseError) throw e; }
    writeJsonAtomic(out, manifest);
    process.stdout.write(`manifest: ${manifest.artifacts.length} artifacts for ${manifest.channel} ${manifest.version}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`manifest: ${e instanceof ReleaseError ? e.message : 'unexpected failure'}\n`);
    return e instanceof ReleaseError ? e.code : 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
