# models (lane C028)

Which model each agent uses, without a price table or a model catalogue.

- **Sources.** The model an engine reports at start (`session.started`), the models its own documented command lists (only with capability `models.list`), and the user's `models.aliases`. A list is cached for 24 h (`models.cacheTtlHours`) in a small file and refreshed when the engine's version changes.
- **Choice.** `--model` flag, then a session override (`/model name`), then project config, then user config, else nothing is passed and the engine uses its own default. Unknown names are passed through; the engine's own refusal is shown word for word and the previous model stays.
- **Switching.** A change applies at the next turn boundary (so usage stays attributable to one model), emits one `model.changed`, and switching to the current model says `Already using <name>.`.
- **Passing.** Claude Code gets `--model <name>` at spawn, Codex the `model` parameter of its thread and turn calls. That mapping lives in the engine adapters.
- **Never here:** prices, context windows, calls to a model API, reading provider config files (a test scans this folder for those).
