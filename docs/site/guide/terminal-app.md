# The terminal app

Run `centcom` in a project folder. Type what you want done and press Enter. `?` lists every key (press Tab for the editing keys and then every command), `/` opens the command menu, `ctrl+k` searches everything.

## Typing

| Keys | What they do |
| --- | --- |
| `shift+←` / `shift+→` | jump a word and select it |
| `shift+home` / `shift+end` | select to the start or end of the line |
| `alt+a` | select everything |
| `ctrl+c` | copy the selection (with nothing selected it interrupts the agent; twice quits) |
| `ctrl+x` | cut the selection |
| `ctrl+delete`, `alt+delete` | delete the word after the cursor |
| `ctrl+w`, `alt+backspace` | delete the word before |
| `ctrl+j`, or `\` then Enter | a new line instead of sending |

Typing over a selection replaces it. Copying uses your terminal's clipboard support and the system clipboard tool (`wl-copy`, `xclip`, `xsel`, `pbcopy`).

A big paste (more than 10 lines or 2,000 characters) shows as a chip like `[Pasted text #1 +42 lines]` and is put back in full when you send. A message can be up to 65,536 characters.

## The mouse

The wheel scrolls the conversation and moves the highlight in lists. Click a row in a list, a button (`[y] yes`, `[a] always`, `[s] session`, `[n] no`) or a command in the `/` menu. A destructive approval needs two clicks, like `y` then Enter. `/mouse off` gives your terminal its own text selection back; Centcom remembers the choice.

## Choosing from lists

`/settings` is one list of every setting with its current value: pick one to change it, and you come back to the list. `Esc` closes it.

Most commands open a list when you give them no value: `/mode`, `/theme`, `/mascot`, `/color`, `/motion`, `/spinner`, `/density`, `/effort`, `/resume`, `/permissions`, `/skills`, `/night remove`, `/night allow`, `/fleet stop`, `/fleet remove`. Move with the arrows (or `j` / `k`), `space` ticks, `a` ticks all, `Enter` confirms, `Esc` cancels. When the agent asks you a question with options, the same list appears; `Esc` lets you type your own answer.

Codex can wait for your answer while it works. Claude Code's questions come back to it as your next message.

## The palette (`ctrl+k`)

Type a few letters of anything: commands (`thm hc` finds `/theme hc`), project files (a pick adds `@path` to your prompt), saved conversations (a pick resumes it) and skills. With nothing typed it shows the commands people use most.

## Settings worth knowing

| Command | Config key | What it does |
| --- | --- | --- |
| `/effort low … max` | | how hard the agent thinks |
| `/theme dark\|light\|hc` | `ui.theme` | Graphite, Paper, or high contrast; `auto` asks your terminal for its background |
| `/spinner plain` | `ui.spinner` | a plain "Working…" instead of rotating verbs |
| `/density compact` | `ui.density` | fewer blank rows between messages |
| `/motion reduced` | `ui.reduced_motion` | no animation |
| `/mouse off` | `ui.mouse` | no wheel or click handling |

Everything you change is remembered. `/config` shows where each value comes from.

## Approvals

A new approval ignores keys for a third of a second so a key you were typing cannot approve something you have not read. It shows how long is left before it is declined on its own (`agent.approval_timeout_ms`, ten minutes by default). `s` allows it for this session only.

## For screen readers

`centcom --screen-reader` (or `CENTO_SCREEN_READER=1`, or `a11y.screen_reader` in your settings) runs the whole app as plain lines: no colour, no boxes, no animation, no redrawing, no escape codes at all. Each thing the agent does is one line (`Tool: Read src/a.ts`, `Status: Cento is editing a file.`). Approvals are asked as `Allow Cento to run: pnpm test? [y/n/a]` and wait for you; lists are numbered and you type the number. `/help` prints the commands as text. Press `ctrl+d` to leave.

`NO_COLOR=1` removes all colour from the normal screen; every status keeps its word and symbol.

## If the agent stops

If the agent's process dies, Centcom says so, stops waiting, and starts it again with your next message, in the same conversation.
