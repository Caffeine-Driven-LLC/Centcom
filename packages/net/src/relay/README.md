# relay client (lane C054)

One connection per session to the relay (or a LAN host), speaking the WebSocket envelope.

- **Handshake:** a fresh single-use ticket for every attempt (`getTicket`), the `centcom.v1` subprotocol, `sys.hello` with the protocol list, capabilities, client identity and `last_seq`, then the `sys.welcome` (checked for protocol, capabilities and heartbeat times).
- **Keeping it alive:** pings and pongs from the welcome's heartbeat settings; a link silent for the dead time is cut and reconnected.
- **Reconnecting:** exponential backoff with jitter; a close code decides whether to retry (4401 asks for a fresh ticket, others stop). The client never reuses a ticket and never puts one in the URL.
- **Sending:** frames are checked against the envelope schema and size limits before they go out, and a send limiter keeps within the relay's per-class rates (queue, sequenced, presence) and honours `sys.slow_down`.
- **Safety:** `wss://` anywhere; `ws://` only with `allowPlainWs` and a private or loopback address (including the IPv4-mapped form), never to the hosted relay. Logs carry no tickets or frame bodies.
- **Events:** `welcome`, `frame`, `notice`, `error`, `slow_down`, `link`, `closed`, `protocol_warning`.

Tested against an in-memory socket server with a manual clock (`packages/net/test/relay`); the mock backend's relay is the integration target.
