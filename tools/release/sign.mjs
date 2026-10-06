#!/usr/bin/env node
// Artifact signing (C012). Signs and verifies release artifacts with Ed25519 as CT-API-RELEASES says:
// the signature covers the 32 raw bytes of the artifact's SHA-256 digest and is stored as base64url.
// It fails closed: no key, a bad key or a key file readable by others means nothing is signed.
// It must never print key material and never modify the artifact.
//
// Usage: node tools/release/sign.mjs --file F --key-file K [--out F.sig]
//        node tools/release/sign.mjs --verify --file F --sig S --pub P [--sha256 <hex>]
// Exit codes: 0 ok, 1 verification failed, 2 usage, key or input error.
import { createHash, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from 'node:crypto';
import { createReadStream, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

/** A failure with the exit code the CLI should use (2 = usage/key/input, 1 = verification failed). */
export class SignError extends Error {
  constructor(message, code = 2) { super(message); this.name = 'SignError'; this.code = code; }
}

const USAGE = 'usage: sign.mjs --file F --key-file K | --verify --file F --sig S --pub P [--sha256 HEX]';
const SIG_BYTES = 64;

/** SHA-256 of a file, streamed so large artifacts are not held in memory. Resolves to the 32 raw bytes. */
export function sha256File(path) {
  return new Promise((ok, fail) => {
    const h = createHash('sha256');
    createReadStream(path).on('error', () => fail(new SignError('artifact is unreadable'))).on('data', (c) => h.update(c)).on('end', () => ok(h.digest()));
  });
}

/** Constant-time equality for two digests (different lengths are simply unequal). */
export function digestEquals(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Loads an Ed25519 private key. On POSIX the file must be a regular file with mode 0600 exactly.
 * Errors never carry key bytes.
 */
export function loadPrivateKey(path, platform = process.platform) {
  let st;
  try { st = statSync(path); } catch { throw new SignError('key file is unreadable'); }
  if (!st.isFile()) throw new SignError('key file is not a regular file');
  if (platform !== 'win32' && (st.mode & 0o777) !== 0o600) throw new SignError(`key file mode must be 0600 (found 0${(st.mode & 0o777).toString(8)})`);
  let key;
  try { key = createPrivateKey(readFileSync(path)); } catch { throw new SignError('key file is not a valid private key'); }
  if (key.asymmetricKeyType !== 'ed25519') throw new SignError('key file is not an Ed25519 key');
  return key;
}

/** Loads an Ed25519 public key (PEM SPKI). */
export function loadPublicKey(path) {
  let pem;
  try { pem = readFileSync(path); } catch { throw new SignError('public key file is unreadable'); }
  let key;
  try { key = createPublicKey(pem); } catch { throw new SignError('public key file is not a valid public key'); }
  if (key.asymmetricKeyType !== 'ed25519') throw new SignError('public key is not an Ed25519 key');
  return key;
}

/** Signs the 32-byte SHA-256 digest with Ed25519; returns base64url without padding. */
export const signDigest = (digest, privateKey) => sign(null, digest, privateKey).toString('base64url');

/** Decodes a base64url signature; returns null if it is not exactly 64 bytes of base64url. */
export function decodeSig(text) {
  const t = text.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(t)) return null;
  const b = Buffer.from(t, 'base64url');
  return b.length === SIG_BYTES && b.toString('base64url') === t ? b : null;
}

/** True when `sig` (base64url) is a valid Ed25519 signature over `digest` by `publicKey`. */
export function verifyDigest(digest, sigText, publicKey) {
  const sig = decodeSig(sigText);
  if (!sig) return false;
  try { return verify(null, digest, publicKey, sig); } catch { return false; }
}

/**
 * Signs `file` with the key in `keyFile` and writes `<out>` (default `<file>.sig`).
 * The key is checked before the artifact is read; the artifact itself is never written.
 */
export async function signFile({ file, keyFile, out }) {
  const key = loadPrivateKey(keyFile);
  const digest = await sha256File(file);
  const sig = signDigest(digest, key);
  const target = out ?? `${file}.sig`;
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${sig}\n`);
  renameSync(tmp, target);
  return { sig, sha256: digest.toString('hex') };
}

/**
 * Verifies `file` against `sigFile` and `pubFile`. If `sha256` is given (from a manifest) the file digest
 * must match it first, compared in constant time. Throws SignError(1) when verification fails.
 */
export async function verifyFile({ file, sigFile, pubFile, sha256 }) {
  const pub = loadPublicKey(pubFile);
  let sigText;
  try { sigText = readFileSync(sigFile, 'utf8'); } catch { throw new SignError('signature file is unreadable'); }
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) throw new SignError('--sha256 must be 64 lowercase hex characters');
  const digest = await sha256File(file);
  if (sha256 !== undefined && !digestEquals(digest, Buffer.from(sha256, 'hex'))) throw new SignError('digest does not match', 1);
  if (!verifyDigest(digest, sigText, pub)) throw new SignError('signature does not verify', 1);
  return { sha256: digest.toString('hex') };
}

/** CLI entrypoint; resolves to the exit code. */
export async function main(argv = process.argv.slice(2)) {
  try {
    let values;
    try {
      ({ values } = parseArgs({ args: argv, options: { file: { type: 'string' }, 'key-file': { type: 'string' }, out: { type: 'string' }, verify: { type: 'boolean', default: false }, sig: { type: 'string' }, pub: { type: 'string' }, sha256: { type: 'string' } }, strict: true }));
    } catch { throw new SignError(USAGE); }
    if (!values.file) throw new SignError(USAGE);
    if (values.verify) {
      if (!values.sig || !values.pub) throw new SignError(USAGE);
      await verifyFile({ file: values.file, sigFile: values.sig, pubFile: values.pub, sha256: values.sha256 });
      process.stdout.write('sign: signature ok\n');
      return 0;
    }
    if (!values['key-file']) throw new SignError(`no signing key given (--key-file); refusing to sign. ${USAGE}`);
    await signFile({ file: values.file, keyFile: values['key-file'], out: values.out });
    process.stdout.write('sign: signature written\n');
    return 0;
  } catch (e) {
    process.stderr.write(`sign: ${e instanceof SignError ? e.message : 'unexpected failure'}\n`);
    return e instanceof SignError ? e.code : 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main();
