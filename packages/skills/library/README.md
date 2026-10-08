# Centcom skill set

Seven skills for agents working in any codebase. Each is a folder with a
`SKILL.md` (loaded when the skill triggers) and a `references/` directory
(loaded only when the task needs that depth), plus small stdlib-only helper
scripts where something deterministic was worth bundling.

| Skill | Owns | Lines |
|---|---|---|
| `design/` | Visual UI, UX, design systems, landing-page layout, motion, accessibility as design, UI copy, mobile conventions, critique | ~7,000 |
| `frontend/` | Component architecture, state, data fetching, rendering, performance, a11y implementation, UI testing, styling architecture, TypeScript | ~6,300 |
| `backend/` | API design, service architecture, auth implementation, jobs, resilience, caching, observability, webhooks, config, backend testing | ~7,700 |
| `security/` | Threat modeling, vulnerability classes (vulnerable → fixed), secrets, supply chain, crypto usage, headers/CSP, LLM-app security, cloud, audit playbook | ~8,100 |
| `database/` | Data modeling, Postgres/MySQL/SQLite/NoSQL, indexing, query plans, transactions, zero-downtime migrations, ORM footguns, scaling, integrity | ~6,500 |
| `marketing/` | Positioning, messaging and copy, conversion, launch, developer marketing, SEO content, email, analytics, brand voice, claims compliance | ~6,700 |
| `code-review/` | Review methodology, severity and feedback, code smells, safe refactoring, reviewing tests and AI-written code, PR hygiene, self-review | ~7,000 |

## Install

Copy the seven folders into the repo's skills directory (for Claude Code
that is `.claude/skills/`; Centcom should use whatever path its skill
loader reads):

```
.claude/skills/
├── design/
├── frontend/
├── backend/
├── security/
├── database/
├── marketing/
└── code-review/
```

Each `SKILL.md` has YAML frontmatter with exactly two keys, `name` and
`description`. The description is what the agent sees in its skill list
and decides from, so it is written to trigger eagerly.

## How the skills relate

The skills hand off to each other by path (`security/references/...`) and
each states its boundary in its own SKILL.md. The main seams:

- `design` decides how UI looks and behaves; `frontend` implements it.
- `design` lays out a landing page; `marketing` writes the words on it.
- `backend` implements auth flows; `security` owns the threat side.
- `backend` wires transactions and caches; `database` owns the schema,
  indexes, query plans and migrations.
- `code-review` owns the practice of reviewing; it pulls the domain skills
  in for domain checks.

## Scripts

All stdlib-only, documented at the top of each file.

- `design/scripts/contrast.py "#fg" "#bg"` – WCAG contrast ratio and pass/fail
- `design/scripts/typescale.py [base] [ratio] [--css]` – modular type scale
- `security/scripts/headers_check.py <url>` – security header report for a running instance
- `security/scripts/secret_patterns.py <paths>` – read-only secret pattern scan
- `database/scripts/explain_summary.py <explain.json>` – EXPLAIN (FORMAT JSON) triage with red flags
- `code-review/scripts/diff_stats.py < diff` – diff triage: risk flags, size, test ratio

`AUTHORING_GUIDE.md` is the brief all seven were written to. Keep it if you
plan to add more skills to the set; it is not loaded by agents.
