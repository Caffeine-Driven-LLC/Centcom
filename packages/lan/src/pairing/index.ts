/** LAN pairing with CPace and session trust (CT-LAN §2). The public surface of lane C073; see README.md. */
export { generatePairingCode, normalizeCode, displayCode, CodeSlot, CODE_ALPHABET, CODE_LENGTH, CODE_TTL_MS, MAX_CODE_ATTEMPTS } from './code.js';
export { initCpace, cpaceStart, calculateGenerator, generatorString, scalarMult, scalarMultVfy, sampleScalar, deriveIsk, transcriptIr, lanChannelId, confirmMac, ctEqual, prependLen, lvCat, DSI, IDENTITY } from './cpace.js';
export { HostPairing, HALF_OPEN_MS, CLOSE_REJECTED, CLOSE_PROTOCOL, CLOSE_TIMEOUT, type HostPairingOptions, type PairedGuest, type PairFailure, type PairFailReason } from './host-pairing.js';
export { guestPair, GUEST_STEP_TIMEOUT_MS, type GuestPairOptions, type GuestPairResult } from './guest-pairing.js';
export { parsePairMessage, encodePairMessage, memoryChannelPair, MAX_PAIR_FRAME, type TextChannel, type PairConn, type PairingHandler, type MemberInfo, type PairDevice, type SessionPolicy, type PairMsg } from './messages.js';
export { SessionTrustStore, checkTrust, type PairingTrustStore, type DeviceRecord, type TrustCheck } from './trust-store.js';
export { ReconnectTokens, tokenValidator, saveGuestToken, loadGuestToken, forgetGuestToken, TOKEN_RE, type TokenValidator } from './reconnect-token.js';
export { MemoryBanList, BAN_MS, BAN_AFTER_FAILURES, type BanList, type MutableBanList } from './ban-list.js';
