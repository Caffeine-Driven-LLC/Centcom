/** `centcom webhooks verify --secret-stdin --signature <header> --body-file <path> [--tolerance 300]`: the receiver check, for debugging. Exit 0 valid, 3 not valid. */
import { one, parseFlags, usage, type WebhookDeps } from './common.js';
import { DEFAULT_TOLERANCE_S, verifyWebhookSignature } from './signature.js';

const WHY = { malformed: 'The signature header is not in the form t=<unix>,v1=<hex>.', stale: 'The timestamp is too far from now (receivers reject more than the tolerance).', mismatch: 'The signature does not match this secret and body.' } as const;
export async function runVerify(argv: string[], d: WebhookDeps): Promise<number> {
  const f = parseFlags(argv); if ('error' in f) return usage(d, f.error);
  const header = one(f, '--signature'); const file = one(f, '--body-file'); if (!f.bools.has('--secret-stdin') || !header || !file) return usage(d, 'Usage: centcom webhooks verify --secret-stdin --signature <Centcom-Signature value> --body-file <path> [--tolerance 300]  (the secret is read from standard input)');
  const tol = one(f, '--tolerance') === undefined ? DEFAULT_TOLERANCE_S : Number(one(f, '--tolerance')); if (!Number.isFinite(tol) || tol < 0 || tol > 86_400) return usage(d, '--tolerance must be a number of seconds from 0 to 86400.');
  let secret: string; let body: Uint8Array; try { secret = (await d.io.readStdin()).replace(/\r?\n$/, ''); } catch { return usage(d, 'Could not read the secret from standard input.'); } if (!secret) return usage(d, 'No secret was given on standard input.');
  try { body = await d.io.readFile(file); } catch { return usage(d, 'Could not read the body file.'); }
  const r = verifyWebhookSignature({ secret, header, rawBody: body, nowS: Math.floor((d.now?.() ?? Date.now()) / 1000), toleranceS: tol });
  if (f.bools.has('--json')) d.io.out(JSON.stringify(r.ok ? { valid: true } : { valid: false, reason: r.reason })); else d.io.out(r.ok ? 'Signature is valid.' : `Signature is NOT valid. ${WHY[r.reason!]}`);
  return r.ok ? 0 : 3;
}
