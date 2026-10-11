# The desktop app

The Electron window around `apps/web` (see `apps/desktop/README.md` for how it is built and run). This page is about what is on the screen.

## Layout

- **Sidebar.** The Centcom name, **New session** and a search button, then:
  - **Running**: every agent session that is alive, with its state (working, needs you, ready). The one the window shows is highlighted; a click on another switches to it. Leaving a project does not stop its agent.
  - **In this project**: saved conversations of the open folder (a click resumes one).
  - **Recent projects**: folders you used before that are not running.
  - The screens (Home, Workspaces, Billing, Settings) sit at the bottom.
- **Chat.** Your messages are soft bubbles on the right, the agent's answer is plain text. Runs of tool calls are one row ("Ran 3 steps") that opens on click; it stays open while a step runs or after one fails. Code blocks have a Copy button, and a finished answer shows "Copy" under it on hover. Mode, model and effort are in the message box.
- **Session panel** (windows wider than about 1180 px; the button in the header hides it): status and running time, step, file and failure counts, context use with tokens and cost, usage limits, the agent's plan, the people and agents in the session, **Shared notes** (the context board of docs/context-sharing.md: what agents and people noted, with pin, remove and a box that adds a note every agent gets with its next message; not shown for the demo agent, which has no board), and the files changed. A click on a file shows its diff.
- **Home.** "What shall we work on?": pick Claude Code or Codex, write a task and press **Start** (it opens the chosen project and sends the task), or open a recent project or any folder.

## Keys

| Keys | What it does |
| --- | --- |
| Ctrl/Cmd+K | Search commands, running sessions, saved sessions, projects, screens and the theme |
| Ctrl/Cmd+N | New session (the open one keeps running) |
| Ctrl/Cmd+B | Hide or show the sidebar (the button in the top bar does the same) |
| `/` in the message box | Lists the slash commands that make sense in the app; Up/Down, Tab or Enter pick one |
| Enter | Send the message (Shift+Enter adds a line) |
| Up and Down in the message box | Walk through earlier messages (on an empty box or at the start of one line) |
| Esc in the message box | Stop the agent while it works |

## Staying informed

- The window title says `(2) Needs you · project` when approvals wait in any running session, and `Working · project` while an agent works.
- A system notification appears when a new approval waits and the window is in the background. Nothing else is sent, and nothing leaves the computer.

## People in a session

The panel lists "You" and the agents. Other people appear when someone else writes in a shared session (their messages carry their name and colour); nothing is made up for a local session.

## How the data gets there

The main process (`apps/desktop/src/local/service.ts`) keeps one `Workspace` per folder and agent. Each window gets that workspace's state, and every window gets the `running` list (`{dir, engine, demo, busy, waiting, ask}` per session) whenever it changes. `leave` goes back to the project list without stopping the agent; `close` ends it. The panel's numbers come from `apps/web/src/local/insights.ts`, which only counts what the transcript and the agent state say.

## Look

The palette is `assets/theme/desktop-palette.css` (warm charcoal and cream, one clay accent); the component styles are `apps/web/src/ui/desktop.css` and `shadcn.css` (plain CSS in shadcn/ui's shapes, because Tailwind's build tooling does not pass the dependency audit). `assets/theme/theme.css` is generated and shared with the terminal, so it is left alone.
