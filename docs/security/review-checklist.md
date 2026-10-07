# Security review checklist

Run before every release. Each item names the script or test that checks it, or an owner in `review-log.md`.

## Secrets
- [ ] No secret in the repository: `pnpm security:check` (secrets)
- [ ] Tokens and keys only in the OS keychain after a login: `tools/security/keystore.ts` scan of the config and state folders (test: `security.test.ts` "keystore scan")
- [ ] Logs and diagnostics are redacted: 10 000-string fuzz in `security.test.ts`, plus `packages/net/test/log.test.ts`
- [ ] Provider credentials are never read: `packages/agent/test` credential tests (C013, C103)

## Sandbox and permissions
- [ ] Permission rules and the command classifier: `packages/agent/test/permissions/*`, `packages/agent/test/sandbox/corpus.test.ts` (C015, C016)
- [ ] MCP and hook configuration cannot be written by repository content: `packages/agent/test/mcp/safety.test.ts`
- [ ] Review the agent runner's environment handling by hand: owner and date in `review-log.md`

## Crypto and transport
- [ ] Known-answer vectors reproduce byte for byte: `pnpm conformance --contract CT-CRYPTO` (C056, C100)
- [ ] Update signatures are verified before apply: `packages/net/test/update/update.test.ts` (C068)
- [ ] The web app's CSP and token storage: owner and date in `review-log.md` (C081, C082; not built yet)

## Supply chain
- [ ] No install scripts, exact versions, lockfile integrity: `pnpm security:check`
- [ ] Licences on the allow-list: `pnpm security:check`
- [ ] `pnpm audit --prod --audit-level=high` is clean: `pnpm security:check`
- [ ] Workflows pinned by SHA with least privilege: `pnpm security:check`
- [ ] An SBOM exists for each artifact: `pnpm sbom --artifact <file> --out <file>.cdx.json`, attached to the release
- [ ] Waivers are listed, have an issue and have not expired: `tools/security/waivers.json`

Findings of severity high block the release gate (`pnpm release-gate`, lane C100) until fixed or waived.
