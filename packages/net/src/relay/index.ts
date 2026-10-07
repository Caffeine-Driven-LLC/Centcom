/** Public surface of the relay WebSocket client (lane C054). Other lanes import from here, never from the files behind it. */
export { RelayClient, CLOSE_GRACE_MS, TICKET_TIMEOUT_MS, type RelayClientOptions, type FrameLink, type OutboundFrame, type RelayState, type LinkState, type ClosedInfo, type RelayEvents, type RelaySocket, type WsFactory, type WsFactoryOptions } from './client.js';
export { CLOSE_POLICY, closePolicy, MAX_PROTOCOL_CLOSES, PROTOCOL_CLOSE_WINDOW_MS, type ClosePolicy, type ReconnectMode } from './close-codes.js';
export { backoffDelayMs, ReconnectPlanner, BACKOFF_BASE_MS, BACKOFF_CAP_MS, IMMEDIATE_MAX_MS, STABLE_RESET_MS, type ReconnectDecision } from './reconnect.js';
export { DeadDetector, pongFor, deadMsFrom, DEFAULT_DEAD_MS, DEFAULT_PING_MS, type RelayClock } from './heartbeat.js';
export { SUBPROTOCOL, HELLO_TIMEOUT_MS, DEFAULT_CAPS, DEFAULT_RELAY_URL, buildHello, readWelcome, checkProtocol, negotiateCaps, checkRelayUrl, isPrivateHost, isRelayHost, type Welcome, type ClientIdent, type UrlCheck } from './handshake.js';
export { SendLimiter, TokenBucket, limitsFromWelcome, sendClassOf, DEFAULT_SEND_LIMITS, MAX_FRAME_BYTES, OUTBOUND_BUFFER_BYTES, MAX_SLOW_DOWN_MS, type SendLimits, type SendClass } from './send-limiter.js';
export { RelayError, FrameTooLargeError, OutboundBufferFullError, type RelayLocalCode } from './errors.js';
export { TypedEmitter } from './emitter.js';
