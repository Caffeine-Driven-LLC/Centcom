/** Typed errors for LAN discovery and pairing, plus the one table of user-facing text. No error ever carries a pairing code, key, MAC, token or a full fingerprint. */
import type { ErrorCode } from '@centcom/protocol';

/** Every sentence the LAN package may show a person. Callers pick by key; nothing is built inline. */
export const LAN_MESSAGES = {
  mdns_unavailable: 'Could not use mDNS on this computer (UDP port 5353 is taken and cannot be shared).',
  manual_join_hint: 'Join directly instead: centcom join <ip>:<port>, then type the pairing code shown on the host.',
  scan_empty: 'No Centcom sessions found on this network.',
  scan_empty_hint: 'If the host turned announcing off (--no-announce) or the network blocks multicast, join directly: centcom join <ip>:<port>',
  scan_join_hint: 'Join with: centcom join <address>:<port>, then type the pairing code shown on the host. Compare the fingerprint on both screens.',
  fingerprint_mismatch: 'The host answered with a different device fingerprint than the one announced on the network. Compare the fingerprint on both screens before trying again.',
  host_identity_required: 'Pairing needs the host session id and fingerprint (from discovery or typed in) before it can start.',
  bad_code: 'That pairing code was not accepted. Check it on the host screen and try again.',
  locked_out: 'Too many wrong codes. Ask the host for a new code and wait 10 minutes before trying again.',
  protocol: 'The pairing messages were not valid.',
  timeout: 'The host did not answer in time.',
  closed: 'The connection closed during pairing.',
  confirm_failed: 'The host could not prove it knows the pairing code. Someone may be in the middle; do not continue.',
  trust_changed: 'This device presented different keys than last time. Compare fingerprints before accepting it.',
} as const;
export type LanMessageKey = keyof typeof LAN_MESSAGES;

/** Base class: `code` is a CT-ERR code where one fits, `reason` the finer LAN reason. */
export class LanError extends Error {
  constructor(readonly code: ErrorCode, readonly reason: LanMessageKey, message: string = LAN_MESSAGES[reason]) { super(message); this.name = 'LanError'; }
}

/** UDP 5353 could not be bound or shared. `hint` says how to join without discovery. */
export class MdnsUnavailableError extends LanError {
  readonly hint = LAN_MESSAGES.manual_join_hint;
  constructor(readonly sysCode?: string) { super('service_unavailable', 'mdns_unavailable'); this.name = 'MdnsUnavailableError'; }
}

export type PairingErrorReason = 'bad_code' | 'locked_out' | 'protocol' | 'timeout' | 'closed' | 'confirm_failed' | 'host_identity_required' | 'trust_changed';
const PAIR_CODES: Record<PairingErrorReason, ErrorCode> = { bad_code: 'pair_bad_code', locked_out: 'pair_locked_out', protocol: 'protocol_violation', timeout: 'timeout', closed: 'service_unavailable', confirm_failed: 'signature_invalid', host_identity_required: 'invalid_request', trust_changed: 'conflict' };

/** Pairing failed on the guest side. The message never names which secret was wrong. */
export class PairingError extends LanError {
  constructor(readonly pairReason: PairingErrorReason) { super(PAIR_CODES[pairReason], pairReason); this.name = 'PairingError'; }
}

/** The fingerprint announced over mDNS differs from the one the host sent while pairing. Only short prefixes are kept. */
export class FingerprintMismatchError extends LanError {
  constructor(readonly expectedPrefix: string, readonly actualPrefix: string) { super('signature_invalid', 'fingerprint_mismatch'); this.name = 'FingerprintMismatchError'; }
}

/** First group of a fingerprint, for logs and errors: never the whole value. */
export const fpHint = (fp: string): string => `${fp.slice(0, 4)}-…`;
