# fleet (lane C042)

The list of agents in a session, most urgent first.

- **`STATE_LABELS`** has a word, glyph, tone and visibility tier (DESIGN 11.2) for every state in `contracts/state-map.json`; a state this client does not know reads `working` and is noted once.
- **`sortFleet`** orders by tier (crash, error and sign-in first; idle and sleeping last), then rows that need you, then the one waiting longest.
- **`reduceFleet`** builds the rows from `agent.spawn`, `agent.state`, `agent.exit` and `branch.update`. An unchanged state returns the same object, so nothing re-renders. An exit shows `done` (ok) or `error <code>`.
- **`<FleetPanel>`** is a 28-column rail (100+ columns) or a full-width overlay. Each row has the owner's colour dot and:
  - **Rail row:** name and state word.
  - **Wide row:** name, owner (`you` or `M · Maya`), branch, state and elapsed time.
  - **Approval state:** your own approval says `needs you`, someone else's says `waiting`.
  - **State and active row:** the state always has a glyph and a word, and the active row is reverse video, so nothing depends on colour.
  - **Keys and timing:** up and down move, enter selects (`onSelect`), esc closes the overlay; elapsed time ticks once a second.

The app shows this panel as its rail (28 columns at 100+ columns, `ctrl+b` toggles it) with a mini Cento (2 rows by 6 columns) beside each row (`mascots` prop), the dot and mascot colours from `memberColor`, and `fleetFromAgents` turning the session's agents into rows. The rail only shows the list; choosing an agent from it and the overlay mode are not wired into the app yet.
