/** Exactly the 18 event types of CT-WEBHOOKS (consumers must tolerate others, but the picker offers these). */
export const WEBHOOK_EVENT_TYPES: readonly string[] = ['workspace.member.joined', 'workspace.member.left', 'workspace.member.role_changed', 'workspace.invite.created', 'workspace.invite.accepted', 'workspace.invite.revoked', 'session.created', 'session.started', 'session.ended', 'session.member.joined', 'session.member.left', 'agent.completed', 'billing.subscription.updated', 'billing.invoice.paid', 'billing.invoice.payment_failed', 'usage.threshold', 'api_key.created', 'api_key.revoked'];
/** Grouped by the first part of the name, in the order the list gives them. */
export function groupEvents(types: readonly string[] = WEBHOOK_EVENT_TYPES): { group: string; types: string[] }[] { const m = new Map<string, string[]>(); for (const t of types) { const g = t.split('.')[0]!; m.set(g, [...(m.get(g) ?? []), t]); } return [...m].map(([group, ts]) => ({ group, types: ts })); }
export const RETRY_SCHEDULE_TEXT = 'A failed delivery is tried again up to 7 times, a little later each time. An endpoint that keeps failing is marked failing and then disabled.';
export const SIGNATURE_FORMAT = 'Centcom-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">';
export const TOLERANCE_S = 300;
/** Static documentation text: no secret ever appears in it. */
export function verifySnippet(lang: 'node' | 'python' | 'curl'): string {
  if (lang === 'node') return `import { createHmac, timingSafeEqual } from 'node:crypto';\nexport function verify(rawBody, header, secret) {\n  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));\n  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > ${TOLERANCE_S}) return false;\n  const mac = createHmac('sha256', secret).update(parts.t + '.' + rawBody).digest('hex');\n  return timingSafeEqual(Buffer.from(mac), Buffer.from(parts.v1));\n}`;
  if (lang === 'python') return `import hmac, hashlib, time\ndef verify(raw_body: bytes, header: str, secret: str) -> bool:\n    parts = dict(p.split("=", 1) for p in header.split(","))\n    if abs(time.time() - int(parts["t"])) > ${TOLERANCE_S}:\n        return False\n    mac = hmac.new(secret.encode(), parts["t"].encode() + b"." + raw_body, hashlib.sha256).hexdigest()\n    return hmac.compare_digest(mac, parts["v1"])`;
  return `# t and v1 come from the Centcom-Signature header; reject if t is more than ${TOLERANCE_S} s old\nprintf '%s.%s' "$T" "$RAW_BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex   # compare with v1`;
}
