# Authoring guide for the Centcom skill set

You are writing one skill in a set of seven that ship inside Centcom, a new
agentic coding tool built on the Claude Code model. The skills are read by a
Claude agent working in a user's repository. The users build *anything*:
React, Vue, Svelte, Next, Rails, Django, FastAPI, Go, Rust, Spring, Laravel,
Swift, Kotlin, Flutter, Postgres, Mongo, SQLite... Your skill has to make the
agent genuinely expert without knowing the stack in advance.

Read this whole file before writing a line.

## What "massive and super smart" means here

The user asked for skills that are "massive and super super smart". Take
that seriously, but understand what actually makes a skill smart:

1. **Judgment over rules.** A smart skill transmits how an expert *thinks*:
   what they look at first, what trade-offs they weigh, what they refuse to
   do and why, what "good" looks like at different levels of effort. Lists of
   MUSTs make the agent rigid and brittle. Explain the *why* behind every
   instruction so the agent can generalize to cases you didn't foresee.
2. **Depth lives in references, not in SKILL.md.** SKILL.md is loaded every
   time the skill triggers, so it should be the sharp core: the workflow,
   the decision points, the quality bar, and a map of where to read more.
   Aim for 300-600 lines. Everything deeper goes in `references/` and is
   loaded only when relevant. A skill can be thousands of lines on disk and
   still cheap to use. That is the design.
3. **Stack-agnostic core, stack-specific leaves.** Principles go in SKILL.md.
   Framework or language specifics go in `references/<stack>.md` and SKILL.md
   tells the agent how to pick which one to read (detect from package.json,
   go.mod, requirements.txt, Gemfile, Cargo.toml, pubspec.yaml, build.gradle,
   Package.swift, composer.json...). Cover at least the mainstream options
   for your domain; be honest when something is a general pattern that
   applies everywhere.
4. **Detect before you act.** Every skill should open with "look at the
   repo first": existing conventions, config, tooling, test setup, design
   tokens, lint rules. An expert joining a codebase matches its conventions
   before imposing their own. Make the agent do the same.
5. **Define the quality bar concretely.** Include a "what excellent looks
   like vs what mediocre looks like" section with specific, recognizable
   examples. Include the common failure modes of an AI agent in this domain
   (e.g. "generic purple-gradient SaaS look", "N+1 queries from the ORM
   default", "security advice that just says 'sanitize inputs'").
6. **Checklists are for verification, not for thinking.** Put a final
   self-review checklist at the end of SKILL.md. Keep it short and
   high-signal. Also tell the agent how to actually verify (run it, screenshot
   it, test it, lint it) rather than just eyeballing.

## Required structure

```
<skill-name>/
├── SKILL.md
├── references/
│   ├── <topic-or-stack>.md       (as many as the domain needs, each 150-600 lines)
│   └── ...
└── scripts/                       (optional; only for deterministic, reusable work)
```

### SKILL.md frontmatter (exact format)

```yaml
---
name: <skill-name>            # kebab-case, matches folder name
description: >
  <2-5 sentences. What it does AND when to trigger. Be "pushy": Claude
  undertriggers skills, so list the concrete phrasings, file types,
  and situations that should trigger it, including ones where the user
  doesn't use the obvious word. End with a sentence that tells the agent
  to use this skill even when it thinks it can handle the task alone.>
---
```

Only `name` and `description` go in frontmatter. No other keys.

### SKILL.md body — recommended shape

1. **One-paragraph purpose**: who the agent becomes when this loads.
2. **First: read the room** — what to inspect in the repo and conversation
   before doing anything; how to detect the stack and conventions; which
   reference file(s) to load as a result. Give a concrete detection table.
3. **Core principles** (5-10) — each with a *why* and a one-line example.
4. **Workflow** — the stages an expert moves through, with decision points.
   Include when to stop and ask the user vs. when to decide and note it.
5. **Quality bar** — excellent vs mediocre, and the AI-specific failure
   modes to avoid in this domain.
6. **Reference map** — a table: file → when to read it → what's inside.
7. **Verification** — how to prove the work is right before handing it over.
8. **Final checklist** — short.

Write in imperative mood, second person optional. Prefer "Do X because Y"
over "You MUST do X". Avoid ALL-CAPS commands. Avoid filler, marketing
tone, and em dashes as the default punctuation; use plain sentences.

### References

- Each reference file starts with a 2-4 line summary and, if over 300
  lines, a table of contents.
- References may be long and detailed: real code, real config, real
  numbers, concrete anti-patterns with the fix. This is where "massive"
  pays off.
- Cross-reference between files when useful ("see security/references/
  auth.md for session design"), but do not duplicate content across skills.
  Each skill owns its domain:
  - `design` owns visual UI, UX, design systems, landing pages, motion,
    accessibility-as-design, copy in the UI.
  - `frontend` owns component architecture, state, data fetching, rendering
    performance, build tooling, testing UI, accessibility-as-implementation.
  - `backend` owns API design, service architecture, auth flows (the
    implementation), background jobs, caching, observability, error handling.
  - `security` owns threat modeling, vulnerability classes, secure defaults,
    secrets, dependency hygiene, auditing existing code for issues.
  - `database` owns schema design, migrations, indexing, query performance,
    transactions, data modeling across SQL/NoSQL.
  - `marketing` owns positioning, messaging, copywriting, launch plans,
    SEO content, email, analytics for growth. (Landing page *layout and
    visual design* is `design`; landing page *copy and conversion
    strategy* is `marketing`. Say so in both.)
  - `code-review` owns reviewing diffs/PRs, refactoring safely, code
    smells, readability, maintainability, giving feedback.

### Scripts

Only include a script when the agent would otherwise rewrite the same
deterministic helper every time (e.g. a contrast-ratio checker, an
EXPLAIN-plan summarizer, a dependency audit wrapper). Scripts must be
small, dependency-light (Python stdlib or Node builtins), and documented
at the top. If in doubt, leave it out.

## Tone and sensibility

Write like a principal engineer / design lead who is generous with
explanation, allergic to cargo cult, and candid about trade-offs. Assume
the reader (the agent) is highly capable and wants to understand, not be
bossed around. Where the field has genuine disagreements, present the
options and the conditions under which each wins.

## Things that make a skill worse

- Repeating the same advice in SKILL.md and in a reference.
- Advice so generic it applies to nothing ("write clean code").
- Locking into one framework in the core.
- Giant numbered lists of rules with no reasoning.
- Pretending there's one right answer when there isn't.
- Padding to hit a length. Length should come from genuine depth.

## Deliverable

Write your skill to `/home/claude/centcom-skills/<skill-name>/`. When done,
list every file you created with its line count, and summarize in 5-10
lines what makes this skill genuinely better than an agent working
without it.
