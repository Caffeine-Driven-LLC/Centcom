/** pnpm exec tsx tools/docs/errors-doc.ts > docs/errors.md   (generated from errors.json and the message table) */
import { ERROR_CODES, ERROR_TABLE } from '../../packages/protocol/src/index.ts';
import { MESSAGES } from '../../packages/net/src/index.ts';
const rows = ERROR_CODES.map((c) => `| \`${c}\` | ${ERROR_TABLE[c].status} | ${ERROR_TABLE[c].retryable ? 'yes' : 'no'} | ${MESSAGES[c].title} | ${MESSAGES[c].hint ?? ''} |`);
console.log(`# Errors

Generated from \`contracts/errors.json\` and \`packages/net/src/errors/messages.en.ts\`. Run \`pnpm exec tsx tools/docs/errors-doc.ts > docs/errors.md\` to refresh.

## How the client treats errors (CT-ERR)

- It switches on \`code\`, never on the server's title or detail. A code this build does not know is handled as its HTTP status class.
- **Retry table:** 400, 403, 404, 409, 410, 422 never retry. 401 refreshes the token once, then asks you to sign in again; tokens that are revoked or invalid never retry. 408, 425 and 429 retry. 500, 502, 503 and 504 retry only for requests that are safe to repeat (GET, HEAD, PUT, DELETE, or POST with an Idempotency-Key). At most 5 attempts.
- **Backoff:** the server's Retry-After if given (plus up to half a second), otherwise full-jitter exponential from 500 ms up to 30 s. A wait longer than 2 minutes is shown to you, not slept through.
- **WebSocket closes:** 1000 and 1001 reconnect. 4401 refreshes the token first. 4400 and 4409 stop (retrying would loop). 4403 and 4404 stop and tell you. 4426 asks you to update. 4408, 4429, 4503 and anything unknown reconnect with backoff (4503 honours the server's retry time). Reconnect delay is 250 ms x 2^n with jitter, capped at 15 s.
- What people see comes from the message table below, never from raw server text. A short, safe server explanation is added only if it contains no credentials or URL query strings. A support reference (\`Ref: req_...\`) is shown whenever there is a request id.
- Errors never block local or LAN work; these helpers only describe what happened.

## Known contract conflict

\`contracts/errors.json\` marks six codes \`retryable: true\` that the normative status table in \`00-foundations.md\` says never to retry: 400 \`authorization_pending\`, 400 \`slow_down\`, 409 \`session_paused\`, 409 \`lock_denied\`, 409 \`key_required\` and 409 \`export_not_ready\`.

\`retryDecision\` follows the status table: it decides on the HTTP status, so 400 and 409 are never retried automatically, whatever the \`retryable\` column below says for these six. A test pins this. Changing it needs a contract decision (device-login polling will need its own path in any case).

## Codes

| Code | Status | Retryable | Shown as | Hint |
|---|---|---|---|---|
${rows.join('\n')}
`);
