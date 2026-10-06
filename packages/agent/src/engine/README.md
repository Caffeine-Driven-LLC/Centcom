# Engine layer

What every engine (Claude Code, Codex, the fake) has in common, so nothing above it branches on which one it is.

- `types` (in `../types.ts`): `AgentEngine`, `EngineSession`, the normalised event catalogue, `ProviderError` and its nine codes.
- `validator.ts`: `EventStreamValidator` / `validated()` check the ordering rules (seq +1, a tool result for every tool request, an approval answer for every approval, text closed before the turn ends, a fatal error followed by `turn.done{error}`). Adapters run their tests through it.
- `registry.ts`: `createEngineRegistry` picks an engine: explicit option, then `agent.engine`, then the first installed of Claude Code and Codex; a switched-off engine is refused.
- `capabilities.ts`: `requireCapability(set, cap)` throws `provider_capability_missing`.
- `coalesce.ts`: `createCoalescer` merges text deltas into frames of at most 4 KiB and 10 per second, never splitting a UTF-8 character, losing nothing.
- `wire-map.ts`: `toSessionWire` turns a normalised event into session wire events (clear part in `p`, secret part in `ct`); model names, engine ids, versions and paths never go in a clear part; unknown states become `thinking`; `provider-*` states stay local. `exitToWire` builds `agent.exit`.
- `testing/`: `loadTranscript`, `createFakeEngine`, `replayTranscript`, `expectGolden`. Six transcripts live in `test/fixtures/transcripts/` with golden outputs; change one only with `UPDATE_GOLDEN=1` and a reviewer note.

No vendor SDK and no `child_process` in this folder (a test enforces it).

## Known gaps
- The stalled-consumer buffer (coalescing deltas under a 1000 event cap) is not built here; the runner's subscriber queue drops old deltas instead.
- `validator` requires `session.started` before text, tools and approvals, but allows `turn.started`, `status` and errors before it (the real engines emit those first).
- The real adapters (Claude, Codex) do not yet close open messages and tools on interrupt the way the validator demands; that belongs to C102/C103.
