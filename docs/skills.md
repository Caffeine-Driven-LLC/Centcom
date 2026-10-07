# Skills pack

Centcom ships five small skills as plain files that Claude Code and Codex load themselves. Centcom never runs anything from a skill.

| Skill | What it is for |
|---|---|
| `commit-message` | a short, clear commit message from the staged changes |
| `code-review` | findings ordered by importance, with file and line |
| `test-writer` | focused tests in the project's own style |
| `pr-description` | what changed, why, how it was checked, what was left out |
| `handoff-notes` | notes so someone else can continue |

## Commands

```
centcom skills status [--scope project|user] [--engine claude|codex]
centcom skills install|update|remove [--scope project|user] [--engine claude|codex] [--yes]
```

- **Claude Code** gets one folder per skill: `.claude/skills/<name>/SKILL.md` (in the project, or `~/.claude/skills` for the user scope).
- **Codex** gets one section in `AGENTS.md`, between `<!-- centcom:skills:begin ... -->` and `<!-- centcom:skills:end -->`. Everything you wrote around it stays byte for byte.
- The **diff is always printed first**, even with `--yes`. The user scope asks a second time, naming the kind of folder (your user folder), not the path.
- **Updates** change only files whose checksum differs from the pack. A file you edited is `modified`: update and remove leave it alone unless you name it.
- **Safe writes:** temporary file then rename, folders 0755, files 0644, never through a symbolic link, never outside the folder.
- **The record** `.centcom/skills-installed.json` (project) or `~/.centcom/skills-installed.json` (user) holds the pack version and the checksum of each installed file, so removal only touches what Centcom wrote.

## For maintainers

The pack is `packages/agent/skills/`: each skill is `<name>/SKILL.md` (front matter `name` and `description`, at most 4 KiB, no scripts) and `manifest.json` lists their checksums. After changing a skill, bump `pack_version` in the manifest and run `node tools/skills/build-manifest.mjs`; CI checks it with `--check`.
