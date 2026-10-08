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
| `ctrl+r` | search your earlier messages in this project |
| `ctrl+g` | write the message in your editor (`$VISUAL`, then `$EDITOR`, else `vi`); what you save comes back into the prompt |
| `ctrl+z` | put the app in the background; `fg` brings it back exactly as it was |

Typing over a selection replaces it. Copying uses your terminal's clipboard support and the system clipboard tool (`wl-copy`, `xclip`, `xsel`, `pbcopy`).

Type `@` and a few letters of a file name to mention a file: matching files from this project are suggested (`↑↓` choose, `Tab` or `Enter` completes, or click). The agent gets the path.

A big paste (more than 10 lines or 2,000 characters) shows as a chip like `[Pasted text #1 +42 lines]` and is put back in full when you send. A message can be up to 65,536 characters.

## The mouse

The wheel scrolls the conversation and moves the highlight in lists. Click a row in a list, a button (`[y] yes`, `[a] always`, `[s] session`, `[n] no`) or a command in the `/` menu. A destructive approval needs two clicks, like `y` then Enter. `/mouse off` gives your terminal its own text selection back; Centcom remembers the choice.

## Choosing from lists

`/settings` is one list of every setting with its current value: pick one to change it, and you come back to the list. `Esc` closes it.

Most commands open a list when you give them no value: `/mode`, `/theme`, `/mascot`, `/color`, `/motion`, `/spinner`, `/density`, `/effort`, `/resume`, `/permissions`, `/skills`, `/night remove`, `/night allow`, `/fleet stop`, `/fleet remove`. `/rewind` alone (or `Esc` twice when idle) walks you through going back: pick the prompt, pick what to put back (files, the conversation, or both), review exactly what changes, then confirm. `/fleet` alone is a menu: start agents (it asks how many, then what for), show them, check a merge, stop or remove them. Move with the arrows (or `j` / `k`), `space` ticks, `a` ticks all, `Enter` confirms, `Esc` cancels. When the agent asks you a question with options, the same list appears; `Esc` lets you type your own answer.

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
| `/bell on` | `ui.bell` | ring the terminal bell when an approval or question needs you, or a task that took 15 seconds or more finishes |

Everything you change is remembered. `/config` shows where each value comes from.

## Finding things

`/find <words>` lists the messages in this conversation that mention them (newest last); pick one and the conversation scrolls there. `ctrl+r` searches your earlier messages in this project, and `ctrl+k` searches commands, files, saved conversations and skills.

## Taking things with you

`/copy` puts the last answer on the clipboard, `/copy code` just its last code block. `/export` saves the whole conversation as a Markdown file in this folder (`/export notes.md` to name it; it never overwrites). Secrets are scrubbed from the file.

## Approvals

A new approval ignores keys for a third of a second so a key you were typing cannot approve something you have not read. It shows how long is left before it is declined on its own (`agent.approval_timeout_ms`, ten minutes by default). `s` allows it for this session only.

## For screen readers

`centcom --screen-reader` (or `CENTO_SCREEN_READER=1`, or `a11y.screen_reader` in your settings) runs the whole app as plain lines: no colour, no boxes, no animation, no redrawing, no escape codes at all. Each thing the agent does is one line (`Tool: Read src/a.ts`, `Status: Cento is editing a file.`). Approvals are asked as `Allow Cento to run: pnpm test? [y/n/a]` and wait for you; lists are numbered and you type the number. `/help` prints the commands as text. Press `ctrl+d` to leave.

`NO_COLOR=1` removes all colour from the normal screen; every status keeps its word and symbol.

## If the agent stops

If the agent's process dies, Centcom says so, stops waiting, and starts it again with your next message, in the same conversation.
