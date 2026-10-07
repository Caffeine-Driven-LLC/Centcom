/** The backend cannot be reached, so a hosted-only action was refused straight away instead of hanging. */
export class OfflineError extends Error { constructor(message = 'You are offline, so this needs to wait. Local and LAN sessions still work.') { super(message); this.name = 'OfflineError'; } }
/** The offline buffer is full (500 frames or 4 MiB): nothing already stored was dropped, the new frame was not stored. */
export class OfflineBufferFull extends Error { constructor(readonly limit: 'frames' | 'bytes') { super(limit === 'frames' ? 'Too many messages are waiting to be sent (500). Reconnect first.' : 'The waiting messages are too large (4 MiB). Reconnect first.'); this.name = 'OfflineBufferFull'; } }
