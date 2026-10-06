# mascot driver (lane C046)

What the mascot does, decided from what the agent is doing. State drives the mascot; nothing here can change agent state.

- **`createMascotDriver`** takes inputs (`state`, `clear`, `tool-call`, `milestone`, `failure`, `activity`) per agent and gives a `MascotView` (`animation`, `loop`, `color`, `visible`, `reason`). Subscribers hear only about changes.
- **Which animation:** the client copy of the state map (`contracts/state-map.json`, all 64 states, each checked against `animations.json`). The state in the lowest priority tier wins (`priorityOf`, DESIGN 11.2); the others are available as `chips()`. An unknown state is `thinking` and logged once.
- **Timing:**
  - At least 600 ms before it switches.
  - More than 3 tool calls in 2 s collapse into one `tool_running`.
  - Entering work from idle plays one 200 ms `prompt_received` beat.
- **Idle:** `idle_breathe`, then `idle_blink` after 20 s, `look_around` after 3 min and `status_away` after 10 min. At night (23:00 to 06:00) after 30 minutes of nothing it sleeps.
- **One-shots:**
  - A failure plays `error` once; a retry does not replay it; a second failure shows `worried`.
  - A milestone is `celebrate` at most once per 10 minutes, otherwise `thumbs_up`. A plain `success` is only `thumbs_up`.
- **Visible only when it should be:** on a terminal of at least 80x30, not `CENTO_MASCOT=off`, not turned off, not suppressed (permission prompts, billing and so on use `setSuppressed`), and during first-run or empty screens, a wait of 8 s or more, a success or failure moment, or `/mascot` (`show`).
- **Reduced motion:** `crash`, `glitch` and `panic` become a single `error`.

`<MascotSlot>` shows the mascot from the view; the drawing itself (`render`) is the half-block renderer of the C033 lane. Not done yet: creating the driver in the app and feeding it from the controller, and the shared tier table with the fleet list (both lanes keep their own copy for now).
