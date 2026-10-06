# Errors

Generated from `contracts/errors.json` and `packages/net/src/errors/messages.en.ts`. Run `pnpm exec tsx tools/docs/errors-doc.ts > docs/errors.md` to refresh.

## How the client treats errors (CT-ERR)

- It switches on `code`, never on the server's title or detail. A code this build does not know is handled as its HTTP status class.
- **Retry table:** 400, 403, 404, 409, 410, 422 never retry. 401 refreshes the token once, then asks you to sign in again; tokens that are revoked or invalid never retry. 408, 425 and 429 retry. 500, 502, 503 and 504 retry only for requests that are safe to repeat (GET, HEAD, PUT, DELETE, or POST with an Idempotency-Key). At most 5 attempts.
- **Backoff:** the server's Retry-After if given (plus up to half a second), otherwise full-jitter exponential from 500 ms up to 30 s. A wait longer than 2 minutes is shown to you, not slept through.
- **WebSocket closes:** 1000 and 1001 reconnect. 4401 refreshes the token first. 4400 and 4409 stop (retrying would loop). 4403 and 4404 stop and tell you. 4426 asks you to update. 4408, 4429, 4503 and anything unknown reconnect with backoff (4503 honours the server's retry time). Reconnect delay is 250 ms x 2^n with jitter, capped at 15 s.
- What people see comes from the message table below, never from raw server text. A short, safe server explanation is added only if it contains no credentials or URL query strings. A support reference (`Ref: req_...`) is shown whenever there is a request id.
- Errors never block local or LAN work; these helpers only describe what happened.

## Known contract conflict

`contracts/errors.json` marks six codes `retryable: true` that the normative status table in `00-foundations.md` says never to retry: 400 `authorization_pending`, 400 `slow_down`, 409 `session_paused`, 409 `lock_denied`, 409 `key_required` and 409 `export_not_ready`.

`retryDecision` follows the status table: it decides on the HTTP status, so 400 and 409 are never retried automatically, whatever the `retryable` column below says for these six. A test pins this. Changing it needs a contract decision (device-login polling will need its own path in any case).

## Codes

| Code | Status | Retryable | Shown as | Hint |
|---|---|---|---|---|
| `access_denied` | 403 | no | Sign-in was cancelled | You declined the request. Start again if that was a mistake. |
| `account_deletion_pending` | 409 | no | This account is being deleted | Cancel the deletion in your account settings if that was a mistake. |
| `api_key_limit_reached` | 403 | no | You have reached the API key limit | Delete one you no longer use. |
| `authorization_pending` | 400 | yes | Waiting for you to finish signing in | Complete the sign-in in your browser. |
| `bad_gateway` | 502 | yes | The server is not answering properly | Try again in a minute. |
| `client_too_old` | 426 | no | This version of Centcom is too old | Update Centcom to keep using hosted sessions. Local and LAN work still run. |
| `conflict` | 409 | no | That changed while you were working | Reload and try again. |
| `coupon_invalid` | 422 | no | That coupon is not valid | Check the code, or it may have expired. |
| `cursor_invalid` | 400 | no | This list expired | Reload it from the start. |
| `device_revoked` | 401 | no | This device was removed from your account | Run centcom login to add it again. |
| `device_unknown` | 404 | no | The server does not know this device | Run centcom login again. |
| `entitlement_required` | 403 | no | Your plan does not include this | Upgrade your plan to use it. |
| `expired_token` | 400 | no | The sign-in code expired | Start the sign-in again and finish it within a few minutes. |
| `export_not_ready` | 409 | yes | Your export is still being prepared | Try again in a few minutes. |
| `forbidden` | 403 | no | You do not have permission to do that | Ask a workspace owner or admin if you need access. |
| `frame_rate_exceeded` | 429 | yes | Sending too fast | Centcom will slow down. |
| `frame_too_large` | 413 | no | That message is too large | Send it in smaller parts. |
| `gone` | 410 | no | That is no longer available |  |
| `history_unavailable` | 410 | no | Older history is no longer available | You will see the session from where it is now. |
| `host_required` | 403 | no | Only the host can do that |  |
| `idempotency_conflict` | 409 | no | That request clashed with an earlier one | Wait a moment and try again. |
| `idempotency_key_required` | 400 | no | Centcom could not safely send that | Update Centcom to the latest version. |
| `internal_error` | 500 | yes | Something went wrong on the server | This is not your fault. Try again in a minute. |
| `invalid_client` | 401 | no | The server does not recognise this app | Update Centcom to the latest version. |
| `invalid_frame` | 400 | no | Centcom sent a message the relay could not read | Update Centcom. If it keeps happening, report it. |
| `invalid_grant` | 400 | no | That sign-in code is not valid | Start the sign-in again. |
| `invalid_request` | 400 | no | That request was not valid | Update Centcom and try again. If it keeps happening, report it with the reference below. |
| `invalid_scope` | 400 | no | Centcom asked for access the server does not offer | Update Centcom to the latest version. |
| `invite_expired` | 410 | no | That invite expired | Ask for a new one. |
| `invite_invalid` | 404 | no | That invite was not found | Ask for a new one. |
| `invite_revoked` | 410 | no | That invite was cancelled | Ask for a new one. |
| `key_required` | 409 | yes | Waiting for the session key | The host needs to be online to share it with you. |
| `key_unknown` | 409 | no | A message used a key you do not have | Rejoin the session to get the latest keys. |
| `lock_denied` | 409 | yes | That file is being edited by another agent | Wait for it to finish, or ask them to release it. |
| `member_exists` | 409 | no | That person is already a member |  |
| `member_limit_reached` | 403 | no | This session is full for your plan | Remove someone or upgrade your plan. |
| `muted` | 403 | no | You are muted in this session | Ask the host to unmute you. |
| `not_a_member` | 403 | no | You are not a member of this workspace | Ask for an invite. |
| `not_found` | 404 | no | That could not be found | It may have been deleted or you may not have access. |
| `owner_required` | 403 | no | Only the workspace owner can do that |  |
| `pair_bad_code` | 403 | no | That pairing code is wrong | Check the code on the other screen and try again. |
| `pair_locked_out` | 429 | yes | Too many wrong codes | Wait a minute, then try again. |
| `payload_too_large` | 413 | no | That is too large to send | Send less at once, for example a smaller file or a shorter message. |
| `payment_required` | 402 | no | Payment is needed | Update your billing details to continue. |
| `precondition_failed` | 412 | no | That was changed by someone else first | Reload to see the latest version, then try again. |
| `protocol_violation` | 400 | no | The connection broke the rules and was closed | Update Centcom. If it keeps happening, report it. |
| `queue_full` | 429 | yes | The queue is full | Wait for some items to finish. |
| `queue_item_gone` | 409 | no | That queue item no longer exists | It was finished or removed. |
| `queue_not_allowed` | 403 | no | You cannot add to the queue here | Ask the host to change your role. |
| `quota_exceeded` | 429 | yes | You used all of this period's hosted time | It resets at the start of the next period, or you can upgrade. Local and LAN work are never blocked. |
| `rate_limited` | 429 | yes | Too many requests | Slow down for a moment. Centcom will try again for you. |
| `refresh_reuse_detected` | 401 | no | This sign-in was ended for your safety | Its token was used twice, which can mean it was copied. Run centcom login, and check your devices in your account. |
| `role_insufficient` | 403 | no | Your role cannot do that | Ask an owner or admin to change your role or do it for you. |
| `seat_limit_reached` | 403 | no | Your workspace has no free seats | Add seats or remove a member. |
| `service_unavailable` | 503 | yes | The service is temporarily unavailable | Try again in a minute. Local and LAN work are not affected. |
| `session_ended` | 410 | no | That session has ended | Start a new one. |
| `session_full` | 403 | no | That session is full |  |
| `session_locked` | 403 | no | That session is locked by the host | Ask the host to let you in. |
| `session_not_found` | 404 | no | That session was not found | It may have ended. Check the link or code. |
| `session_paused` | 409 | yes | The session is paused | It will continue when the host resumes it. |
| `signature_invalid` | 400 | no | A message failed its signature check and was dropped | If this repeats, leave and rejoin the session. |
| `slow_consumer` | 429 | yes | Your connection cannot keep up | Centcom will reconnect and catch up. |
| `slow_down` | 400 | yes | Checking too often | Centcom will check less often. |
| `snapshot_hash_mismatch` | 409 | no | The saved copy did not match | Centcom will fetch it again. |
| `snapshot_missing` | 404 | no | There is no saved copy to catch up from | Centcom will rejoin the session from now. |
| `subscription_inactive` | 403 | no | Your subscription is not active | Renew it in billing. Local and LAN work still run. |
| `ticket_invalid` | 401 | no | Your session pass is not valid | Centcom will get a new one. |
| `ticket_replayed` | 401 | no | That session pass was already used | Centcom will get a new one. |
| `timeout` | 504 | yes | The server took too long to answer | Check your connection and try again. |
| `token_expired` | 401 | no | Your sign-in expired | Centcom will refresh it. If that fails, run centcom login. |
| `token_invalid` | 401 | no | Your sign-in is not valid | Run centcom login to sign in again. |
| `token_revoked` | 401 | no | This sign-in was ended | Run centcom login to sign in again. |
| `unauthorized` | 401 | no | You need to sign in | Run centcom login. |
| `unsupported_media_type` | 415 | no | Centcom sent data in a format the server does not accept | Update Centcom to the latest version. |
| `unsupported_protocol` | 400 | no | This Centcom and the server cannot talk to each other | Update Centcom to the latest version. |
| `validation_failed` | 422 | no | Some details are not valid | Check the highlighted fields and try again. |
| `webhook_limit_reached` | 403 | no | You have reached the webhook limit | Delete one you no longer use, or upgrade. |
| `webhook_url_invalid` | 422 | no | That webhook address is not allowed | Use a public https address. |
| `workspace_not_found` | 404 | no | That workspace was not found | It may have been deleted, or you may not be a member. |

