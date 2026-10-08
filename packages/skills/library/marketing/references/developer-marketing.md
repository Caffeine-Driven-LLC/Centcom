# Developer marketing

Marketing to people who are trained to detect marketing. What developers
respond to and what they despise, the README as a landing page, docs as the
primary marketing surface, changelogs and release notes people actually
read, open source growth dynamics, DevRel basics for a team without a DevRel
hire, community (Discord, GitHub Discussions), technical blog posts that
rank and get shared, and examples, templates and starter repos as an
acquisition channel.

## Contents

1. How developers evaluate a tool
2. What they respond to, what they despise
3. The README as landing page
4. Docs as marketing
5. Changelogs and release notes
6. Open source growth dynamics
7. DevRel without a DevRel team
8. Community: Discord, Discussions, forums
9. Technical blog posts that rank and get shared
10. Examples, templates and starters as acquisition
11. Developer-specific copy rules
12. Failure modes

## 1. How developers evaluate a tool

The evaluation sequence, which marketing should serve in order:

1. **What is it?** Read the first two lines of the README or the hero. Ten
   seconds. If unclear, close the tab.
2. **Is it alive?** Last commit date, release cadence, open issue count
   versus closed, response time on issues. Thirty seconds.
3. **Can I try it in five minutes?** Install command, quickstart, a runnable
   example. If the quickstart requires an account, a credit card or a
   sales call, most leave.
4. **Does it do the thing?** Run the example against their actual problem.
5. **What are the sharp edges?** Search issues for their stack; read the
   limitations; check the license; check what it phones home.
6. **Who else uses it?** Stars as a rough signal, named companies in the
   README, mentions in places they trust.
7. **Will it still exist?** Who maintains it, how is it funded, bus factor.

Marketing's job is to make each step fast and honest. Anything that slows
or obscures a step (a landing page without an install command, a gated
quickstart, hidden pricing, an undisclosed telemetry call) costs more
than any amount of copy can recover.

## 2. What they respond to, what they despise

**Respond to:**
- A one-line description that uses the correct technical nouns
- An install command visible without scrolling
- A quickstart that works on the first try and produces visible output
- Real benchmarks with the methodology and the script
- Honest limitations, stated before they find them
- Comparison to the alternatives that admits where the alternatives win
- A changelog that tells them whether to upgrade
- Fast, substantive responses on issues
- The maintainer showing up in the HN thread and answering the hard question
- Technical depth: how it works, not just what it does
- Dry humour, used sparingly
- Being treated as a peer

**Despise:**
- Superlatives and hype vocabulary ("blazing fast" is the one exception
  developers tolerate, and it is wearing thin)
- "Book a demo" as the only path to trying a CLI or library
- Docs behind a signup wall
- Pricing hidden behind "contact us" for a self-serve product
- Growth tactics: popups, exit-intent modals, "wait, before you go", chat
  widgets that open themselves
- Fake urgency and scarcity
- Astroturfing, sockpuppets, paid "organic" posts (detected and
  broadcast)
- Undisclosed telemetry, or telemetry that is opt-out
- Marketing that misdescribes the technology ("blockchain-powered" for a
  database, "AI" for a regex)
- Being told how to feel ("You'll love...")
- Emoji-laden READMEs for serious tools
- Sales follow-up after a free signup
- Rewriting history in the changelog
- Any suggestion they are not smart enough to evaluate it themselves

The pattern: developers want to evaluate; marketing that helps them
evaluate is welcome, marketing that tries to persuade instead is
rejected.

## 3. The README as landing page

For an open source or developer tool, the README is read more than the
website and trusted more. Structure it as the landing page it is.

**Above the fold** (first screen on GitHub, roughly 25 lines):

````markdown
# pgtypes

TypeScript types from your live Postgres schema. No ORM; keep your SQL.

[CI badge] [npm version] [license]

```bash
npm i -D pgtypes
npx pgtypes gen --url $DATABASE_URL --out src/db/types.ts
```

```ts
import type { users } from './db/types'
const u: users = await sql`select * from users where id = ${id}`
```

Works with pg, Postgres.js, Kysely, or anything that returns rows.
Reads the live database or a migrations directory. Single binary,
~0.8s on a 200-table schema in CI.
````

That is the hero: one-liner, proof of life (badges), install, a result
the reader can picture, and the three facts that position it. Everything a
developer needs to decide whether to spend five minutes is visible without
scrolling.

**Below the fold**, in this order:
1. **Why** (3-6 sentences): the problem and the alternatives, honestly.
   "Prisma gives you types but owns your queries. Hand-written types drift.
   pgtypes generates from the schema that is actually deployed."
2. **Quickstart** (under 5 minutes, tested on a clean machine): numbered
   steps, each with the command and the expected output. If step 3 is
   "configure your environment", the quickstart is not done.
3. **How it works** (one paragraph or a diagram): the mechanism. Developers
   trust what they understand.
4. **Features** as a table or terse list, with links to docs for each.
5. **Comparison** to the alternatives (a table; honest; link to a fuller
   page).
6. **Limitations / not supported**: the sharp edges, before they find
   them.
7. **Configuration** reference or link.
8. **Who uses it**: logos or names with permission; if none, omit.
9. **Contributing, license, security policy, support channel.**

**Badge discipline.** Badges are proof of life and nothing else. Keep: CI
status, latest version, license, maybe downloads or stars if impressive.
Remove: "made with love", "PRs welcome", "awesome", language badges,
badges for every service you use, anything animated. Eight badges in a
row reads as insecurity.

**The quickstart in under five minutes** is the single most important
asset. Test it: new machine or container, follow the README literally,
time it, note every point where you had to know something not written.
Fix those. Then have someone else do it.

**Visuals in READMEs:** a terminal recording (asciinema, VHS, or a GIF
under 2MB) of the quickstart beats a screenshot; a screenshot beats a
logo; a logo beats nothing. A 400px hero logo with a tagline is the
README equivalent of a stock photo.

**Keep the README and the website saying the same thing.** Same one-liner,
same install command, same version. Divergence is the first thing a
careful developer notices, and it reads as nobody being in charge.

## 4. Docs as marketing

For a developer product, docs are the most-visited pages after the
homepage, the pages that rank in search for the most valuable queries
("how to X with Y"), and the place where the evaluate-and-adopt decision
actually happens. Treat them as marketing surfaces without making them read
like marketing.

**What good docs do for marketing:**
- The introduction page restates the one-liner and the "why", so a reader
  arriving from search understands the product in one paragraph
- The quickstart is the conversion event; instrument it
- Guides for the top use cases rank for "[use case] with [stack]" queries
  that have higher intent than any blog post
- A comparison or migration guide ("Migrating from Prisma") captures
  switchers at the exact moment of switching
- An honest limitations page builds trust and reduces support load
- Every page has a "was this helpful" signal and an edit link (shows the
  project is alive and open)

**Docs structure that works** (Diátaxis is a reasonable default):
tutorials (learning), how-to guides (tasks), reference (API), explanation
(concepts). Marketing cares most about the tutorial (first success) and
the how-tos (search intent).

**Docs copy rules:** second person, present tense, imperative for steps;
one idea per paragraph; code before prose where possible; every code block
runnable as pasted; expected output shown; no marketing adjectives in
docs ("powerful", "simple") because they lower trust in the surrounding
technical content; version-specific notes clearly marked.

**Search intent in docs:** the how-to guide titles should be the queries.
"Generate types from a Supabase database" not "Supabase integration".
"Handle Postgres enums in TypeScript" not "Enum support". See
`seo-content.md` for the method.

**Gated docs are a conversion killer.** Docs behind login lose the search
traffic (crawlers cannot see them), lose the evaluator (who leaves), and
signal that the product has something to hide. The exception is genuinely
enterprise-only products with a sales motion, and even then the public docs
should cover the product fully.

## 5. Changelogs and release notes

A changelog is read by three audiences: existing users deciding whether to
upgrade, evaluators checking whether the project is alive, and search
engines. Write for the first; the other two follow.

**Entry format:**

```markdown
## 0.4.0 – 2026-10-02

### Breaking
- `--schema` now takes a comma-separated list; the old repeatable flag
  form still works but warns. (#231)

### Added
- `--watch` regenerates on schema change. ~40ms per cycle on a 200-table
  schema. (#198)
- Postgres `range` types map to a `Range<T>` helper type. (#204, thanks
  @mkrause)

### Fixed
- Enum types with a trailing comma generated invalid TS. (#212)
- Views with the same name as a table in another schema collided. (#219)

### Notes
- Node 16 is no longer tested; it probably still works.
```

Rules: categorize (Breaking first, always); one line per change with the
issue or PR link; credit external contributors by handle; state the
observable effect, not the internal change ("regenerates on schema change"
not "added fs watcher"); numbers where they exist; no "various
improvements"; no marketing ("exciting new feature"); date every release.

**Release notes versus changelog.** The changelog is the complete record.
Release notes (the blog post, the email, the thread) for a significant
release pick the two or three changes that matter, explain why, show them
working, and link the changelog. A release note that is the changelog
pasted into an email will not be read.

**The changelog as marketing surface:** a public `/changelog` page with an
RSS feed and a date on every entry is the cheapest "we are alive" signal a
product can have. Evaluators check it. Monthly summaries ("October in
pgtypes") posted to the blog and to social are a sustainable content
cadence that requires no new ideas.

## 6. Open source growth dynamics

Open source growth is word of mouth with the friction removed. What drives
it:

**Stars** are a vanity metric that nonetheless functions as social proof and
as a ranking input in GitHub search and trending. They arrive in bursts
from launches and posts, and in a trickle from search and dependency graphs.
Do not ask for stars in the README; it reads as needy. A star-history chart
in a retrospective post is fine.

**The dependency graph** is the real distribution: being used in one popular
project puts you in front of everyone who reads its `package.json`. Getting
adopted by a framework, a starter template or a well-known project is worth
more than any launch. Contribute to those projects; make the integration
trivial; write the "using X with Y" guide.

**Awesome lists, directories and aggregators** (awesome-*, alternativeto,
the language-specific registries' trending pages) produce a steady trickle
and backlinks. Submit once, properly.

**Issues as marketing.** Every fast, kind, substantive issue response is
read by future evaluators. Closing an issue with "fixed in 0.4.1, thank you
for the clear repro" is content. Leaving issues unanswered for a month is
anti-content.

**Contributors.** Good first issues, a CONTRIBUTING.md that actually
explains the dev setup, fast review, and public credit turn users into
contributors and contributors into advocates. Each contributor has a
network.

**The license question** is asked early; answer it in the README header.
MIT and Apache-2.0 are frictionless. AGPL, BSL, SSPL and "fair source"
licenses are legitimate choices but need an explanation page, because the
evaluator will otherwise assume the worst. Changing a license later is a
reputational event; plan it as one.

**Open core and the hosted offering.** State clearly what is open, what is
paid, and the principle for deciding ("everything a single developer needs
is open; team and compliance features are paid"). Developers accept open
core when the line is principled and stable; they revolt when features move
from open to paid.

**Telemetry.** If you collect it, it is opt-in or it is clearly disclosed at
first run with a one-command opt-out, and the docs list exactly what is
sent. Undisclosed telemetry discovered by a user is a launch-sized event in
the wrong direction.

## 7. DevRel without a DevRel team

Developer relations for a two-person team is the founders doing a few
things consistently:

- **Show up where the ICP is.** The relevant Discord servers, subreddits,
  Stack Overflow tags, GitHub discussions of adjacent projects. Answer
  questions, including ones not about your product. Mention the product
  only when it is the honest answer, with disclosure.
- **Talk.** Local meetups and conference lightning talks accept small-team
  speakers readily. A 10-minute talk about a technical problem you solved,
  with the product as the example, produces a recording that works for
  years. Submit to the CFPs of the conferences your ICP attends; the
  acceptance rate for specific, technical, non-promotional talks is higher
  than founders assume.
- **Write.** One substantial technical post a month (section 9).
- **Help loudly.** When a user hits a wall, fix it and write the guide so
  the next one does not. Each guide is a search landing page.
- **Office hours.** A weekly 30-minute open call, posted in Discord. Few
  come; those who do become the core community.
- **Partner integrations.** Write the integration with the popular adjacent
  tool and the guide for it; ask the adjacent tool to list you. Both sides
  get content.

Measure DevRel by activation and retention of developers who came through
those channels, not by talk count or follower count.

## 8. Community: Discord, Discussions, forums

**When to start a community space:** when support questions are repeating
and users would benefit from seeing each other's answers; typically after
a few hundred active users. Before that, a Discord with four members and
the founders is a visible emptiness; use GitHub Issues and Discussions,
which look fine when quiet.

**GitHub Discussions** suits open source: searchable, indexed by Google
(each thread is a long-tail landing page), low maintenance, no moderation
burden, and it keeps the community where the code is. Categories: Q&A,
Ideas, Show and tell, Announcements. Convert good Q&A threads into docs.

**Discord** suits products with real-time questions and a social component;
it is where developers under 35 are. Costs: not indexed, so answers are lost
to search; needs moderation; dies visibly when quiet. Mitigations: a bot
that archives good Q&A to Discussions or docs; a small set of channels
(#general, #help, #showcase, #announcements) rather than twenty; founders
present daily at a predictable hour; a code of conduct enforced once,
publicly, early.

**Slack** suits B2B products whose users are already in Slack all day; it is
worse than Discord for everything else (history limits on free plans,
no discoverability).

**Forums (Discourse, Flarum)** suit mature products with a large user base
and long-form questions; overkill before that.

**Community stages**, with the founder's job at each:
1. Zero to 50 members: the founders answer everything within an hour and
   greet each person by name. It feels like a group chat. That is right.
2. 50 to 500: a few regulars emerge; give them recognition and small powers
   (a role, early access). Document the recurring answers. Start office
   hours.
3. 500 to 5,000: appoint moderators from the regulars; create the
   contributor path; the founders step back from answering everything and
   toward setting direction and celebrating members' work.
4. Beyond: a community manager becomes a real job.

Community rules that keep it healthy: no DMs from the company to members
for marketing; announcements channel is low volume; criticism is answered,
not deleted; showcase channel is celebrated; help channel is answered by
the company within a stated time.

## 9. Technical blog posts that rank and get shared

The posts that work for developer tools are not about the product. They are
about a problem the ICP has, solved in depth, with the product appearing as
one honest option or as the thing that was built because of the problem.

**Formats that work:**
- **The deep dive**: "How Postgres enum types actually work (and why every
  ORM gets them slightly wrong)". Ranks for the technical query, gets
  shared because it taught something, mentions the product once.
- **The benchmark with methodology**: "Type generation for Postgres: Prisma
  vs Kysely codegen vs pgtypes on a 200-table schema". Ranks for the
  comparison query; gets shared and argued about; must be reproducible and
  must show where you lose.
- **The postmortem or lesson**: "We shipped a column rename to production
  and the types didn't notice". Shared because it is honest; converts
  because the reader has the same fear.
- **The build log**: "How we made schema introspection 10x faster". Shared
  in the language community; recruits contributors.
- **The migration guide**: "Migrating from Prisma to raw SQL with types".
  Ranks for the exact query of a switcher.
- **The opinion with evidence**: "You probably don't need an ORM". Shared
  widely, controversial, brings the right people and the wrong people;
  worth doing once you have the proof to defend it.

**What does not work:** the feature announcement dressed as a tutorial; the
listicle ("10 TypeScript tips") with no point of view; the SEO post written
to a keyword with no experience behind it; "Why we built X" without the
specific failure that motivated it.

**Craft:**
- The first paragraph states the problem and promises the specific
  structure of the answer. No throat-clearing.
- Code is real, runnable and tested; broken sample code is remembered.
- Show the output, not just the code.
- Admit what you do not know and where the approach fails.
- One clear takeaway at the end; link to the product once if relevant.
- Title is the query someone would type or the claim someone would
  argue with. "Understanding Postgres types" is neither.
- Length is whatever the explanation needs; 1,200-2,500 words is typical for
  a deep dive; a 400-word post that says one true thing well also works.

**Distribution for technical posts:** HN (if it stands alone), the
language subreddit (if it teaches), the newsletters in the niche (submit),
Lobsters (strict; only if genuinely technical), the relevant Discord
#articles channel, your own list. Post it where the discussion will
happen, then participate.

## 10. Examples, templates and starters as acquisition

A working example is the most convincing marketing a developer tool can
have, and templates are a distribution channel in their own right.

**The examples directory** (`examples/`): one per popular stack
combination (`examples/nextjs-postgres-js`, `examples/sveltekit-kysely`,
`examples/express-pg`). Each is minimal, runs with two commands, has its
own README with the one thing it demonstrates, and is tested in CI so it
does not rot. Examples rank for "[your tool] with [framework]" queries and
are what people actually copy.

**Starter templates** (`npx create-X`, `degit`, GitHub template repos):
a starter that includes your tool as the default puts you in every project
created from it. Build your own starter; more valuable, get included in
popular existing starters (T3, create-vite templates, framework official
examples) by contributing the integration and the docs.

**Playgrounds**: a browser playground (StackBlitz, CodeSandbox, a custom
WASM build) that lets the evaluator try the tool without installing it
removes the biggest friction in step 3 of section 1. For a CLI, a terminal
recording is the fallback.

**Integration guides with adjacent tools**: "pgtypes with Supabase",
"pgtypes with Neon", "pgtypes with Drizzle migrations". Each is a search
landing page and a reason for the adjacent tool to link to you. Pitch them
the guide for their docs.

**Template marketplaces** (Vercel templates, Railway templates, Render
blueprints, Docker Hub, the Raycast store, VS Code marketplace, GitHub
Actions marketplace): each is a directory with search and an audience
already in deploy mode. A listed template that deploys with one click is
acquisition that runs without you.

## 11. Developer-specific copy rules

On top of `messaging-and-copy.md`:

- Lead with the install command or the code, not the headline, when the
  medium allows it (README, docs, Show HN).
- Use the precise technical noun: "Postgres", not "your database"; "CLI",
  not "tool"; "generates TypeScript types", not "provides type safety".
- Say the version, the platform, the runtime requirement in the first
  screen.
- Quantify with the unit: "11KB gzipped", "0.8s cold", "40ms per cycle",
  "200 tables". Developers compare in units.
- State limitations unprompted. The sentence "Postgres only; MySQL is not
  planned" increases conversion among Postgres users and saves everyone
  else time.
- Never claim "zero config" unless it is literally true from install to
  output. "One flag" is a fine claim if that is what it is.
- "Blazing fast" is tolerated but say the number instead.
- Avoid "simple" and "easy"; show the three-line example and let them
  judge.
- First person plural from a small team ("we built this because") reads
  well; corporate third person ("Acme is committed to") does not.
- Humour: dry, rare, and never in error messages or pricing.
- Never use "developers" as the audience word in copy aimed at developers;
  it is like addressing a letter "Dear human". Name the stack or the role.

## 12. Failure modes

- **The landing page with no install command.** The reader wants to try it;
  the page wants them to "learn more".
- **A README that is a logo and a feature list.** No install, no example,
  no why. Evaluators leave in ten seconds.
- **Quickstart that assumes knowledge.** "Configure your environment" or
  "set up your database" as a step. Tested only by the author.
- **Gated docs or gated pricing** on a self-serve product.
- **Marketing adjectives in technical content.** "Our powerful, intuitive
  API" in the docs lowers trust in the next paragraph.
- **Changelog entries that hide changes.** "Various improvements" and
  silent breaking changes. Users find out in production and tell everyone.
- **Asking for stars** in the README, in the CLI output, in a popup.
- **Treating the community as a lead list.** DMs, newsletters without
  consent, "quick question" sales pings to Discord members.
- **Blog posts about the product** when the audience wanted a post about the
  problem.
- **Sockpuppets and astroturfing.** Detected, screenshot, posted. One
  incident outlives years of good work.
- **Undisclosed telemetry.** Same.
- **A Discord with four people.** Start with Discussions.
- **Divergent README and website.** Two one-liners, two install commands,
  two versions. Pick one source of truth and generate or copy from it.
