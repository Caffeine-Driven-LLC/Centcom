/** How `centcom -p` ends, as a number scripts can rely on. */
export const EXIT_CODES = { ok: 0, failure: 1, usage: 2, denied: 3, provider: 4, limit: 5, unavailable: 6, timeout: 124, interrupted: 130 } as const;

const PROVIDER = new Set(['provider_not_installed', 'provider_not_signed_in', 'provider_policy_blocked', 'provider_method_disabled']);
const LIMIT = new Set(['provider_cap_reached', 'provider_rate_limited', 'rate_limited', 'quota_exceeded', 'too_many_requests']);
const UNAVAILABLE = new Set(['provider_protocol_error', 'provider_version_unsupported', 'network_error', 'unavailable', 'service_unavailable', 'internal_error', 'bad_gateway', 'timeout_upstream']);

/** A provider code (CT-PROVIDER §9), a CT-ERR code, an HTTP status or an error carrying one of those. */
export function exitCodeFor(err: unknown): number {
  const e = err as { code?: unknown; status?: unknown } | string | number | undefined;
  const code = typeof e === 'string' ? e : typeof e === 'object' && e ? String(e.code ?? '') : '';
  const status = typeof e === 'number' ? e : typeof e === 'object' && e && typeof e.status === 'number' ? e.status : undefined;
  if (code === 'timeout') return EXIT_CODES.timeout; if (code === 'interrupted') return EXIT_CODES.interrupted; if (code === 'usage') return EXIT_CODES.usage; if (code === 'denied') return EXIT_CODES.denied;
  if (PROVIDER.has(code)) return EXIT_CODES.provider;
  if (LIMIT.has(code) || status === 429) return EXIT_CODES.limit;
  if (UNAVAILABLE.has(code) || (status !== undefined && status >= 500)) return EXIT_CODES.unavailable;
  return EXIT_CODES.failure;
}
