# settings (lane C047)

Look-and-feel settings you can change while the app runs: `/theme`, `/mascot`, `/spinner`, `/motion`, `/density`.

- **`createSettingsStore`** holds the values and tells subscribers at once. Environment variables (`CENTO_THEME`, `CENTO_MASCOT`, `CENTO_SPINNER`, `CENTO_REDUCE_MOTION`) override stored values for the session, and `source(key)` says where a value comes from (`default`, `user config`, `project config`, `env CENTO_THEME`).
- **The commands:**
  - With no argument: `Theme: dark (user config). Options: dark, light, auto, hc.`
  - With a good argument: the change is applied and saved through `persist`.
  - With a bad one: `Unknown theme "x". Try dark, light, auto or hc.`, and nothing changes.
  - Under an environment override: it is stored and the person is told `Overridden by CENTO_THEME for this session.`
  - If saving fails: the value stays applied and the person is told `Couldn't save this setting. It applies until you quit.`
  - `/mascot red` stores the colour, `/mascot on|off` the visibility.
- **`useSettings()` / `useDensity()`** read the store from React; `blockGap` is the blank rows between transcript blocks (1 comfortable, 0 compact).

The app's own `/theme`, `/mascot`, `/color` and `/motion` handling in `controller.ts` still does the work today. Moving it onto this store, and feeding density into the transcript layout, is not done yet.
