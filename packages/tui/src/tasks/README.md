# Tasks and progress

- **`<TaskList items maxRows width>`**: an agent's plan. `○` pending, `◐` in progress (bold), `✓` done (dimmed); `[ ] [~] [x]` without Unicode. Header `Tasks 3/7`. At most `maxRows` rows (default 10); the item in progress is always visible and `⋯ +N more` counts the rest. Text from the model is cleaned (no escape codes, one line) and cut with `…`, never wrapped.
- **Where tasks come from**: the engines' own plans become a `tasks.updated` event (Claude Code's `TodoWrite`, Codex's `turn/plan/updated`). `reduceTasks` replaces the whole list each time, keeps order, keeps the last version of a repeated id, and stops at 200 items. In the app the list sits above the prompt; `ctrl+t` shows or hides it (remembered with the conversation). The fleet panel moved to `ctrl+b`.
- **`<ProgressBar value label width>`**: `Label ▕███████░░░░░▏ 62 %` (`[#####-----] 62 %` without Unicode). Always labelled. Without a value it is indeterminate: a 6-cell block sliding one cell every 80 ms and bouncing at the ends, or a static bar with `…` in reduced motion. The timer stops on unmount.
- **`useProgress(bus, id)`**: follows `progress` events (`{ id, value, total?, label }`, at most one render per 80 ms); a `total` of 0 means unknown.
- Pure helpers for tests and other lanes: `renderBar`, `barLine`, `indeterminateFrame`, `visibleTasks`, `truncate`.
