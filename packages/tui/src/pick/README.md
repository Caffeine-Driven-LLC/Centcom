# pick

One list for choosing: pick one thing, or tick several. Used wherever the app used to ask you to type a word.

- **`model.ts`** is the whole state as pure functions: `newPick`, `pickMove` (wraps), `pickToggle`, `pickAll`, `pickResult`. A one-of list returns the highlighted option; a list of several returns the ticked ones in list order. The highlight starts on the ticked option.
- **`MultiSelect.tsx`** draws it, centred, with `confirm` and `cancel` buttons; rows and buttons can be clicked.
- **`AppController.pick({ title, options, checked, multi, confirm })`** opens it and resolves with the chosen ids, or `undefined` when you press Esc. `pickKey`, `pickClick` and `pickAnswer` drive it (keys, the mouse, and the plain-text screen-reader mode).
- Used by `/mode`, `/theme`, `/mascot`, `/color`, `/motion`, `/spinner`, `/density`, `/bell`, `/effort`, `/resume`, `/permissions`, `/skills`, `/settings`, `/find`, `/fleet`, `/rewind`, `/night remove`, `/night allow`, ctrl+r, the model list for Codex, and for questions from the agent (Claude Code's `AskUserQuestion` and Codex's `requestUserInput`).
