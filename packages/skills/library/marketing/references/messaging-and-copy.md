# Messaging and copy

How to turn positioning into words that a specific reader believes. Covers
the messaging hierarchy that keeps every asset consistent, headline
approaches, benefit laddering, the techniques that make copy specific,
voice and tone, reading level and rhythm, CTA copy, the microcopy handoff
to design, a large bank of before/after rewrites with reasoning, and a list
of words and patterns to ban with the reason for each ban.

## Contents

1. The messaging hierarchy
2. Headlines
3. Benefit laddering (and when to stop)
4. Specificity techniques
5. Voice and tone spectrum
6. Reading level, sentence length, rhythm
7. CTA copy
8. Microcopy handoff to design
9. Before/after bank
10. Words and patterns to ban, and why
11. Writing process that produces good copy

## 1. The messaging hierarchy

Positioning (see `positioning.md`) is a set of decisions. Messaging is the
small set of sentences that render those decisions, which every asset then
reuses. Without it, the landing page, README, launch post and welcome email
each describe a slightly different product.

```
One-liner          what it is + for whom + the differentiator; under 12 words
Expanded one-liner the one-liner plus one sentence of mechanism; 25-40 words
Value propositions 2-4; each: claim (the change), mechanism (how), proof (evidence)
Objections         the 3-6 reasons the target hesitates, each with its answer
Proof inventory    every number, name, demo, benchmark you may cite, with source
Not-for            one sentence on who should use something else
```

Value proposition format, kept tight:

```
Claim:      Your types can't drift from production.
Mechanism:  pgtypes generates them from the live schema on every CI run.
Proof:      0.8s on a 200-table schema (bench/README.md); three teams
            migrated from Prisma (discussions #41, #58, #77).
```

Write the hierarchy before any asset, even for a "just a headline" request.
Then each asset is a rendering: the landing hero is the one-liner plus the
first value prop; the README intro is the expanded one-liner plus the
quickstart; the Show HN post is the expanded one-liner plus the mechanism
plus the honest limitations; the welcome email is one value prop plus the
first action.

Order the value props by what the target customer cares about most, not by
what the team is proudest of. The "switched from Prisma" person cares about
"keep your SQL" before "fast in CI".

## 2. Headlines

A headline's job is to earn the next sentence from the right reader. It is
not the whole pitch. Approaches that work, with the condition under which
each wins:

**Name the category and the differentiator.** "Type generation for
Postgres, without the ORM." Wins when the category is understood and the
differentiator is crisp. The workhorse for developer tools.

**Name the outcome in the reader's words.** "Get paid 11 days sooner."
Wins when a measurable outcome exists and is proven. Fails when the
number is invented or when the outcome is generic ("save time").

**Name the enemy.** "Stop chasing invoices." "No more hand-written types."
Wins when the alternative's pain is acute and universal in the target
group. Fails when overused (every page in the category says "stop X").

**State the mechanism plainly.** "Transcribed on your phone. Never
uploaded." Wins when the mechanism is the differentiator and the reader is
technical enough to see the implication.

**The honest confession.** "We got tired of Jira. So we built the opposite."
Wins for small teams pre-launch where the founder's story is the proof.
Fails at scale; it reads as twee once there are 500 customers.

**The specific claim with a number.** "Deploys in 8 seconds. Not 'fast'. 8
seconds." Wins when the number is real and the category is known for
vagueness. Fails if the number is unimpressive to the audience (a
developer knows 8 seconds is good for a container deploy and bad for a
function).

**The question the reader is already asking.** "Why does your test suite
take 40 minutes?" Wins for problem-first positioning where "do nothing" is
the alternative. Fails when the reader is not asking it.

What makes these not sound like formulas: they come from the truth sheet,
they contain a noun or number specific to this product, and they avoid the
headline-writing vocabulary ("unlock", "supercharge", "the future of").
A formula shows when the content is swappable; a headline where you can
swap the product name for a competitor's and nothing breaks is a formula.

Mechanics:
- Under 12 words. Under 8 is better for typographic heroes (see
  `design/references/landing-pages.md`).
- Sentence case, not Title Case; Title Case reads as a press release.
- No terminal period on a single-line headline; two-sentence headlines get
  periods on both.
- The subhead carries what the headline cannot: the mechanism, the
  audience, or the proof. Headline and subhead should not say the same thing
  twice at different lengths.
- Write 15 headlines, pick 3, test if traffic allows. The first five are
  always the obvious ones.

## 3. Benefit laddering (and when to stop)

The ladder: feature (what it does) to advantage (what that enables) to
benefit (what changes in the reader's life). The "so what?" question climbs
it.

```
Feature:    Generates types from the live database
Advantage:  Types always match what is deployed
Benefit:    You stop shipping the class of bug where the column was
            renamed and the code did not notice
```

Where to stop: one rung above the feature for developers, two for business
buyers, never three. "So you can focus on what matters" and "so you can
grow your business" are the fourth rung and mean nothing. Developers
usually want the feature and the advantage, and will infer the benefit;
spelling out "so you can ship with confidence" insults them.

Give the mechanism with the benefit. "Get paid sooner" alone is a claim;
"Get paid sooner: reminders go out at due date, +7 and +14 automatically,
in a tone you choose" is a benefit with a reason to believe it.

Laddering failure: adding "so you can" to a feature and calling it a
benefit. "Real-time collaboration so you can collaborate in real time."
Diagnostic: if the benefit clause restates the feature with the word
"you", it is not a benefit.

## 4. Specificity techniques

Specificity is not a style; it is the mechanism by which copy becomes
believable. Techniques, from cheapest to most expensive:

**Replace the adjective with the number.** "Fast" becomes "under 50ms".
"Lightweight" becomes "11KB gzipped". "Scalable" becomes "tested to 40k
concurrent connections". Needs a real measurement; the repo often has one
in `bench/`, tests, or CI logs.

**Replace the category word with the concrete noun.** "Integrations" becomes
"Xero, QuickBooks and FreeAgent". "Modern frameworks" becomes "Next,
SvelteKit and Remix". "Your data" becomes "your Postgres tables".

**Name the alternative.** "Unlike ORMs" becomes "Unlike Prisma". Legal note:
naming a competitor is fine if the comparison is true and verifiable; see
`claims-and-compliance.md`.

**Name the situation.** "When you need it" becomes "at 2am when the
migration fails". "Teams" becomes "a backend team of four".

**State the constraint.** "Works everywhere" becomes "Postgres 12 and up;
MySQL is not supported." Constraints make the rest of the page more
credible because the reader sees you are willing to say no.

**Describe the mechanism instead of the result when you lack proof.** You
cannot yet say "saves 10 hours a week" (no study). You can say "reminders
go out automatically at due, +7, +14; you write them once". The reader
computes the saving themselves and believes it more.

**Use the reader's exact phrase.** From issues, support, forums: "the types
drifted", "chasing invoices", "I can never find the recording". These
phrases prove you have met them.

**Date the number.** "2,400 stars" is ok; "2,400 stars (Oct 2026)" is
better; a live badge is best. Undated numbers read as stale.

**Show the thing.** A code snippet, a terminal recording, a screenshot of the
actual reminder email. For developers, 6 lines of code are worth 60 words
of description. Copy's job is often to frame the artifact, not replace it.

## 5. Voice and tone spectrum

Voice is the stable personality; tone is how it flexes by context. Place
the product on each axis deliberately, from existing material (see
`brand-voice.md` for extraction):

```
Formal     ◄──────────────────────────► Casual
Serious    ◄──────────────────────────► Playful
Reserved   ◄──────────────────────────► Enthusiastic
Expert     ◄──────────────────────────► Peer
Terse      ◄──────────────────────────► Expansive
```

Defaults that work for this skill's typical audience (developers and small
teams): slightly casual, serious with room for dry humour, reserved,
peer-expert (the voice of a senior colleague, not a vendor), terse. The
reasons: enthusiasm reads as sales, formality reads as enterprise, playful
reads as a consumer app unless the product is one.

Tone shifts by context while voice holds:

| Context | Shift |
|---|---|
| Landing hero | Confident, declarative, short |
| Docs intro | Helpful, precise, slightly warmer |
| Changelog | Factual, terse, specific; dry humour allowed in one line |
| Error message | Calm, actionable, zero personality |
| Launch post | Personal, first person, honest about limits |
| Pricing page | Plain, unambiguous, no jokes |
| Apology / incident | Direct, specific, no spin |
| Win-back email | Human, brief, no guilt |

A voice that cannot shift is a gimmick; one that shifts too far is
inconsistent. The test: read the hero and the error message; same company?

## 6. Reading level, sentence length, rhythm

**Reading level.** Aim for grade 7-9 (Flesch-Kincaid) for landing pages and
emails even when the audience is technical. Technical readers prefer
simple sentences about complex things; complexity should live in the
nouns, not the syntax. Jargon the audience uses is fine ("idempotent",
"WAL"); jargon they do not use is not. Docs can run higher; marketing
should not.

**Sentence length.** Average 12-18 words; vary between 4 and 30. A page of
uniform 15-word sentences has machine rhythm. A page of 6-word sentences
has ad-copy rhythm. Both tire the reader.

**Paragraphs.** On the web, 1-3 sentences. Longer paragraphs are fine in a
blog post or a Show HN body; on a landing page a four-sentence paragraph
will not be read.

**Rhythm tells of machine-written copy** (see `copy-review.md` for the full
list): every paragraph ending in a short punchy fragment; parallel
constructions in threes; "It's not X. It's Y."; "Not just A, but B"; em
dashes doing the work commas and periods should; sentences that start
with "Because" or "Whether" as a pattern; a rhetorical question followed
by its answer in every section. Any one is fine. The pattern is the tell.

**Read aloud.** The single most reliable test. Where you stumble or run out
of breath, the reader stops.

## 7. CTA copy

The button names what happens when you click it, from the reader's side.
Rules of thumb:

- Verb plus object: "Start a free project", "Read the quickstart", "Run the
  benchmark", "Install with npm", "See pricing", "Book 20 minutes".
- Avoid: "Get started" (started with what?), "Learn more" (about what?),
  "Submit", "Sign up" (for what?), "Click here".
- Match the reader's state. A stranger on a dev tool page: "Install" or
  "Read the docs". A B2B visitor comparing options: "See how it works" to a
  demo video, or "Start free trial" if self-serve. A developer should never
  be asked to "Contact sales" as the only path; a `npm install` line in the
  hero outperforms any button for OSS.
- One primary per screen. A second CTA is a text link, and it serves the
  reader who is not ready: "Read the docs", "See a 90-second demo", "Compare
  to Prisma".
- Reduce the implied commitment where honest: "Start free, no card" only
  if no card is required; "Takes 2 minutes" only if measured.
- First person tests ("Start my trial") sometimes beat second person; this
  is a legitimate A/B test, not a rule.
- The sentence under the button (the "click trigger") carries the
  objection killer: "Free for solo developers", "No credit card", "Cancel
  anytime", "Open source, MIT".

CTA copy for emails: one link, the anchor text is the action, repeated at
most twice (once in context, once at the end).

## 8. Microcopy handoff to design

In-product microcopy (button labels, errors, empty states, tooltips) is
`design`'s domain. Marketing's contribution is the voice guide and the
specific words where a marketing page meets product: the signup form, the
pricing CTAs, the onboarding checklist, the "what's new" panel. Deliver
these to `design` as a table:

| Element | Copy | Character limit | Note |
|---|---|---|---|
| Hero headline | TypeScript types from your live Postgres schema | 48 | Two lines max at 1440 |
| Hero subhead | Keep your SQL. Lose the drift. Single binary, runs in CI. | 60 | |
| Primary CTA | Install in 30 seconds | 24 | Links to #quickstart |
| Secondary CTA | Compare to Prisma | 20 | Text link |
| Click trigger | MIT licensed. No account needed. | 40 | Under primary |
| Signup field placeholder | you@company.com | | Not "Enter your email" |
| Signup button | Send me the guide | 20 | |
| Signup success | Sent. Check your inbox (and spam, once). | 45 | |

Give lengths in characters for anything in a fixed layout; design cannot
plan a hero around copy that might be 30 or 90 characters.

## 9. Before/after bank

Each entry: the draft, the rewrite, and why. The "before" lines are the
kind a model produces by default; recognize them.

**Hero, developer tool**

Before: "Unlock the power of type-safe database access with our
revolutionary, developer-first platform."
After: "TypeScript types from your live Postgres schema. Keep your SQL."
Why: "unlock the power", "revolutionary", "developer-first platform" carry
zero information. The rewrite names the input (Postgres schema), the output
(TypeScript types), the mechanism (live) and the differentiator (keep your
SQL) in eleven words.

**Hero, B2B SaaS**

Before: "The all-in-one solution for modern services firms to streamline
operations and boost cash flow."
After: "Invoices from approved hours. Follow-up handled. You get paid without
writing the awkward email."
Why: "all-in-one", "solution", "modern", "streamline", "boost" are the
five most common filler words in SaaS copy. The rewrite names the input,
the differentiator (follow-up handled), and the emotional pain in the
reader's words.

**Hero, consumer app**

Before: "Capture your thoughts effortlessly with AI-powered voice
intelligence."
After: "Voice notes you can search. Transcribed on your phone, never
uploaded."
Why: "effortlessly", "AI-powered", "voice intelligence" are category noise.
The rewrite names the behaviour the reader already has (voice notes), the
value (search) and the privacy mechanism.

**Subhead**

Before: "Our platform leverages cutting-edge technology to deliver seamless
experiences across your entire workflow."
After: "One binary. Reads your schema, writes `types.ts`. Runs in CI in
under a second."
Why: the before could be any product. The after is three facts.

**Feature description**

Before: "Powerful real-time collaboration lets your team work together
seamlessly."
After: "Two people can edit the same invoice; you see each other's cursor
and nothing is overwritten."
Why: "powerful", "seamlessly" are banned; "real-time collaboration" is the
feature name, not what it does. The rewrite describes the behaviour the
user will observe.

**Benefit (false ladder)**

Before: "Automated reminders so you can automate your reminders and save
time."
After: "Reminders go out at due, +7 and +14 in a tone you choose. You write
them once."
Why: the before restates the feature as a benefit. The after describes the
mechanism and lets the reader see the time saved.

**Social proof (invented)**

Before: "Trusted by thousands of developers worldwide."
After (pre-launch): "Used in production by the team that built it, on a
200-table schema. We'd like you to be the second."
After (launched): "2,400 GitHub stars. 14 teams in production that we know
of (Oct 2026)."
Why: the before is unverifiable and, at version 0.3, false. The pre-launch
version is honest and disarming; the launched version gives dated,
checkable numbers.

**Testimonial (invented)**

Before: "'This tool changed how our team works!' - Sarah K., CTO"
After: remove, or replace with a real quote with permission, name, company
and a link. If none exists: a quote from a public GitHub issue or tweet,
attributed and linked, with the author's consent for use on a sales page.
Why: invented testimonials are an FTC and consumer-law issue, not a style
issue. See `claims-and-compliance.md`.

**Comparison**

Before: "Unlike legacy tools, we're built for the modern stack."
After: "Prisma owns your queries. pgtypes only generates the types; use pg,
Kysely, Postgres.js, whatever you already have."
Why: "legacy", "modern stack" are evasions. Naming the alternative and the
exact difference is the whole value of a comparison.

**Pricing tier description**

Before: "Pro: For professionals who want more."
After: "Pro: for teams of 2-10 sending more than 20 invoices a month. Adds
client approval and the Xero sync."
Why: the before says nothing. The after names who, the usage threshold,
and what is added.

**Launch post opener**

Before: "We're thrilled to announce the launch of our revolutionary new
platform!"
After: "We spent a year maintaining hand-written types for a 200-table
Postgres schema. Then we got a column rename wrong in production. pgtypes
is what we built afterwards."
Why: "thrilled to announce" is the single most skipped opener on the
internet. A story with a specific failure earns the second paragraph.

**Email opener**

Before: "Hi there! I hope this email finds you well. I'm reaching out
because..."
After: "You installed pgtypes yesterday but haven't run `pgtypes gen` yet.
Here's the one command, and what it will produce:"
Why: the before is three sentences of nothing. The after knows what the
reader did and gives them the next action in the first line.

**Changelog entry**

Before: "Various improvements and bug fixes to enhance your experience."
After: "Fixed: enum types with a trailing comma generated invalid TS (#212).
Added: `--watch` regenerates on schema change, ~40ms per cycle."
Why: the before is contemptuous of the reader. The after tells them whether
to upgrade.

**Show HN title**

Before: "Show HN: The future of database tooling is here"
After: "Show HN: pgtypes – TypeScript types from a live Postgres schema, no ORM"
Why: HN readers flag hype and reward plain description. The after is the
one-liner, which is exactly the HN convention.

**Call to action**

Before: "Get started today!"
After: "Install with npm" (dev tool) / "Start free, no card" (SaaS, if true)
/ "Download on the App Store" (consumer).
Why: the before names no action and the exclamation mark adds urgency with
no reason.

**About section**

Before: "We are a passionate team of innovators dedicated to transforming
the way businesses operate."
After: "Two of us, in Lisbon and Toronto. We ran an agency for six years and
chased invoices the whole time. This is the tool we wanted."
Why: specifics (count, places, history) are what makes a small team
credible. "Passionate innovators" makes them sound like a slide.

**SEO intro**

Before: "In today's fast-paced digital landscape, database type safety is
more important than ever. In this comprehensive guide, we'll explore..."
After: "If you use Postgres with TypeScript and you don't want an ORM, you
have three ways to get types: write them, generate them from migrations, or
generate them from the live database. Here's how each fails."
Why: the before is two sentences of throat-clearing that search engines
and readers both skip. The after answers the query in the first sentence
and promises a specific structure.

**Feature list to benefit prose**

Before:
- Real-time sync
- Advanced analytics
- Enterprise-grade security
- 24/7 support
After: "Every reminder you send and every payment that lands shows up in
Xero within a minute. You can see which clients always pay late. Data is
encrypted at rest and in transit, and we're SOC 2 Type I (report on
request). Support answers in under 4 hours on weekdays; the two founders
are on it."
Why: lists of noun phrases are checkboxes; prose that states the behaviour
and the proof (SOC 2 type, response time) is believable. Note "enterprise-
grade" is replaced by the actual certification.

**Objection handling**

Before: (nothing; the page ignores the objection)
After: "If you want an ORM, use Prisma or Drizzle; they're good. pgtypes is
for teams who've decided to write SQL."
Why: naming who should not buy makes the pitch credible to who should.

**Pricing anchor**

Before: "Affordable pricing for teams of all sizes."
After: "$12 per seat per month. A five-person firm pays $60; one chased
invoice usually covers it."
Why: "affordable" is a claim the reader evaluates themselves; the after
gives the number and the comparison that makes it feel small.

**Tagline**

Before: "Empowering developers to build the future."
After: "Types that can't drift."
Why: the before is a mission statement for any company; the after is three
words only this product can say.

## 10. Words and patterns to ban, and why

Each ban has a reason. If a banned word is the only accurate word, use it;
that is rare.

| Ban | Why | Use instead |
|---|---|---|
| Unlock, unleash, harness, supercharge, empower, elevate, revolutionize, transform (as a verb for the product) | Pure intensifiers; they claim impact without stating it | The specific verb: generate, send, deploy, find |
| Seamless, effortless, frictionless | Unfalsifiable; every product claims them | The specific absence: "no config file", "one command" |
| Powerful, robust, scalable, flexible, intuitive | Adjectives readers discount to zero | The number or constraint that proves it |
| Cutting-edge, next-generation, state-of-the-art, modern, innovative | Date instantly; say nothing about the product | What is actually new, named |
| Solution, platform (when it is a tool), ecosystem | Evasions of the question "what is it" | The category noun: CLI, library, app, service |
| Leverage, utilize, streamline, optimize (as the headline verb) | Corporate register; signal a vendor, not a peer | Use, speed up, cut |
| Best-in-class, world-class, industry-leading, #1, the best | Unprovable or legally actionable comparative claims | A proven, dated comparison or nothing |
| Trusted by thousands/millions (without a number) | Unverifiable; readers assume invented | The actual count, dated |
| Game-changer, disruptive | Hype vocabulary; triggers skepticism in technical readers | Describe the change |
| AI-powered (as the lead) | Table stakes in 2026; says nothing about what the AI does | What it does: "summarizes", "generates", "classifies" |
| All-in-one | Signals nothing is done deeply | The two or three things it does |
| Enterprise-grade | Meaningless without the certification | The certification: SOC 2 Type II, ISO 27001 |
| "I hope this finds you well", "I'm reaching out" | Universally skipped email openers | The reason you are writing, in sentence one |
| "In today's fast-paced world/digital landscape" | Throat-clearing; readers and search engines skip it | Answer the question |
| "Whether you're a X or a Y" | Writing for everyone; names no one | Name the one reader |
| "It's not X. It's Y." / "Not just X, but Y." as a rhythm | Machine cadence when repeated; one per page at most | Plain statements |
| Three adjectives in a row | Rhythm filler; the third is always weakest | One adjective, or a noun |
| Rhetorical question then answer, every section | Pattern reads as a template | Vary; mostly state |
| Exclamation marks in B2B or developer copy | Unearned enthusiasm | Periods |
| "Welcome to the future of" | Parody of itself | Delete |
| Emoji as bullets or in headlines (B2B/dev) | Reads as consumer or as effort to seem fun | Plain bullets |
| "Simply", "just", "easily" before an instruction | Minimizes the reader's difficulty; condescending if it is not easy | Delete the adverb |
| "Our mission is to" on a landing page | The reader wants to know what it does | Put the mission on the About page |
| Em dash as default clause joiner | Over-used in generated text; now a tell | Period, comma, colon, or restructure |

Patterns to limit rather than ban: tidy triads (one per page), parallel
structure (fine in a list, suspicious in prose), "Here's the thing"
openers, bolded phrase at the start of every bullet.

## 11. Writing process that produces good copy

1. Truth sheet and messaging hierarchy first (SKILL.md Stage 0 and 1).
2. Outline the asset: section, purpose, length. For a page, this is the
   design handoff skeleton.
3. Write the ugly draft in one pass without editing. Use placeholders like
   `[NUMBER]` where proof is needed rather than inventing one.
4. Fill placeholders from the proof inventory. Any that cannot be filled
   becomes a mechanism description or is cut.
5. Rewrite for specificity: for each sentence, what noun or number could
   replace an adjective?
6. Rewrite for rhythm: read aloud; vary sentence length; remove triads and
   em dashes; cut 20%.
7. Run `copy-review.md`'s pass as a stranger.
8. Compare register to existing material; adjust toward theirs.
9. Deliver with a one-paragraph rationale: who it is for, what the
   differentiator is, what proof it rests on, what you would test first.
