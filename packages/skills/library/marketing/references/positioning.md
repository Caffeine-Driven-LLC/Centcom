# Positioning

How to decide what a product is, who it is for, and why it beats what the
buyer uses today, before any copy is written. The method here follows April
Dunford's five components (competitive alternatives, unique attributes,
value, target customer, market category) because it starts from what is
true rather than from a slogan. Includes three worked examples, how to find
the real alternative, category trade-offs, a statement template, and ways
to test positioning for roughly zero dollars.

## Contents

1. What positioning is and is not
2. The method, in order
3. Finding the real alternative
4. Worked example: a developer tool
5. Worked example: a B2B SaaS
6. Worked example: a consumer app
7. Choosing a market category
8. The positioning statement template (and why you never publish it)
9. Testing positioning cheaply
10. Repositioning and pivots
11. Failure modes

## 1. What positioning is and is not

Positioning is the set of decisions about which context a product is
understood in: what it is compared to, what makes it different in that
comparison, what that difference is worth, and to whom. It is upstream of
messaging (the words), branding (the feel), and tactics (the channels). If
positioning is wrong, excellent copy sells the wrong thing to the wrong
person efficiently.

It is not a tagline. It is not "we are the Uber of X" (that is a shortcut
for a category decision, and usually a bad one). It is not a persona deck.
It is not what the founder wishes the product were in two years.

The test of good positioning: a member of the target customer group hears
the one-liner and immediately (a) knows what the product replaces, (b)
knows why it might be better for them, and (c) knows whether they are the
sort of person it is for. If any of the three requires explanation, the
positioning has not been done.

## 2. The method, in order

The order matters because each component constrains the next. Do not
start with the category; that is the last decision, not the first.

### Step 1: List the competitive alternatives

Not "competitors". Alternatives: what would the customer do if this product
did not exist? Include the unglamorous ones. For most new products the
honest list is some mix of:

- A big incumbent they tolerate (Jira, Salesforce, Datadog, Mailchimp)
- A general-purpose tool bent to the job (spreadsheets, Notion, bash
  scripts, cron, a Slack channel)
- An internal thing someone built (the "scripts/ folder" alternative)
- Hiring or outsourcing (an agency, a contractor, an intern)
- Doing nothing and living with the problem
- A direct competitor startup (often the least important alternative at
  the start, however much the founder watches them)

Write them down with the share you believe each has among your likely
buyers. Source this from: GitHub issues ("coming from X"), docs
"migrating from" pages, support conversations, the founder's own story
(they usually built it because an alternative failed them), and asking the
user. Guessing here corrupts everything downstream.

### Step 2: Isolate the unique attributes

What does this product have or do that the alternatives do not? Be
literal and technical. "Better UX" is not an attribute; "runs entirely in
the browser with no server" is. "AI-powered" is not an attribute in 2026;
"generates the migration from the diff of two schema files" is.

Read the code if you have to. The README, the architecture, the
constraints the builders chose (single binary, no runtime, local-first,
Postgres-only, opinionated defaults) are attributes. Include attributes
that look like limitations; "Postgres only" is a feature to a Postgres
shop.

Cross off anything an alternative also has. What remains is the raw
material. If nothing remains, the product has a problem no copy can fix,
and you should say so.

### Step 3: Map attributes to value

For each attribute, ask "so what?" twice. Attribute: single static binary.
So what? Installs with one curl, no runtime, no dependency conflicts. So
what? A new team member is productive in two minutes and ops does not
have to manage a Node version. That second "so what" is value: a change in
the customer's situation.

Group the values into two to four themes. A product with eight values
has no positioning; the themes are where you choose.

### Step 4: Identify who cares most

Which customers care about these values so much that they will switch, pay
or tolerate a young product? Characteristics that predict this: they feel
the alternative's weakness acutely (scale, cost, a recent incident), they
have the technical fit (they already use the stack you assume), and they
have the authority or autonomy to adopt (an individual developer can
`npm install`; a compliance team cannot).

This is your target customer. Describe them by situation, not demography:
"a backend team of 3-10 running Postgres on RDS who ship migrations
weekly and have been bitten by a bad one". Not "mid-market tech
companies".

### Step 5: Choose the market category

Now, and only now: what frame makes the value obvious to that customer?
Three options, discussed in section 7: join an existing category and
compete on your attributes, join an existing category and redefine what
matters, or create a new category. The default for a small team is the
first.

## 3. Finding the real alternative

The most common positioning error is competing with the wrong thing. Some
diagnostics:

**Ask what they would do tomorrow if you shut down.** Not "which
competitor would you choose" but "what would you do". The answer is
frequently "go back to the spreadsheet" or "keep using the thing we were
already using and just not have this". That thing is the alternative.

**Look at where your users came from.** Issues, support tickets, onboarding
surveys: "I was using X" or "we had a script that". Count them.

**Look at what your own README compares to.** Builders often know the
alternative; it is the thing they were angry at. Check the "Why" or
"Motivation" section.

**Distinguish the alternative from the aspiration.** A founder of a
two-person analytics tool will say the competitor is Amplitude. Their
actual users were using Google Analytics, Plausible, or nothing. Position
against the thing users actually have, and let the aspiration inform the
roadmap.

**"Do nothing" is often the leader.** If most of the target market tolerates
the problem, the positioning job is first to make the problem feel costly
(problem-first messaging), then to present the product. Products in this
situation need education content more than comparison pages.

**When the alternative is a general tool, the positioning writes itself.**
"Spreadsheets" as the alternative implies the value is structure,
collaboration, and not breaking at scale. "Bash scripts" implies the value
is reliability, observability and not being owned by the one person who
wrote them. Name the general tool explicitly in copy; it is a sentence
every target customer recognizes.

## 4. Worked example: a developer tool

Product (from the repo): a CLI that watches a Postgres schema and generates
TypeScript types plus a typed query client; single binary; no ORM; reads
the live database or a migration directory; works with any query runner.

**Alternatives** (from issues and the README's "why"): Prisma (ORM with
generated types, ~45% of mentions), hand-written types kept in sync by
discipline (~30%), Kysely with manual type definitions (~15%), Drizzle
(~10%).

**Unique attributes** after crossing off what alternatives share:
- No ORM: it does not own the query layer, so it works with raw SQL,
  Kysely, pg, Postgres.js, whatever is already there.
- Generates from the live database, so the types reflect what is actually
  deployed, including views and functions.
- Single binary, no Node runtime needed at generation time; runs in CI in
  under a second on a 200-table schema (benchmark in `bench/`).
- Postgres only, and uses Postgres-specific types (enums, arrays, jsonb,
  ranges) correctly where general ORMs flatten them.

**Value**:
- Keep raw SQL and still get end-to-end type safety (the Prisma switcher's
  value: they wanted types, not an ORM).
- Types cannot drift from production because they are generated from
  production (the hand-written-types person's value: they have been
  burned by drift).
- Postgres features are first-class (the Drizzle/Kysely person's value:
  they chose Postgres for these features and the tool fought them).

**Who cares most**: TypeScript backend teams of 2-15 on Postgres who have
chosen to write SQL (or use a query builder) rather than an ORM, who have
shipped at least one type/schema mismatch bug. They care because the
alternative set forces a bad trade: adopt an ORM they do not want, or
maintain types by hand.

**Category**: "type generation for Postgres" rather than "ORM" or "database
toolkit". Positioning as an ORM invites comparison on ORM features it
deliberately lacks; "database toolkit" is vague; "type generator" is
exactly what it is and the Prisma switcher searches for "generate
TypeScript types from Postgres schema".

**One-liner that falls out of this**: "TypeScript types from your live
Postgres schema. Keep your SQL; lose the drift." Compare the generic
version a model writes without doing this work: "Supercharge your
database workflow with powerful, type-safe tooling." The second says
nothing a Prisma switcher recognizes.

## 5. Worked example: a B2B SaaS

Product: a web app for small professional-services firms (accountants,
consultancies, agencies) that turns time entries into client invoices and
chases payment automatically; integrates with Xero and QuickBooks;
per-seat pricing.

**Alternatives** (from onboarding survey and support): Harvest (~35%),
spreadsheets plus the accounting package's own invoicing (~30%), Toggl plus
manual invoicing (~20%), FreshBooks (~15%).

**Unique attributes**:
- Payment chasing is automatic and sequence-based (reminder at due date,
  +7, +14, with escalating tone the user controls), with a public ledger of
  what was sent. Harvest and FreshBooks remind once; spreadsheets do not.
- Invoices are generated from approved time with a client-visible approval
  step, so disputes happen before the invoice, not after.
- Two-way sync with the accounting package including payment status, so
  the firm's books and the chaser agree.

**Value**:
- Get paid sooner without the awkward emails (the real pain for a
  five-person firm: the founder is the one chasing, and hates it).
- Fewer invoice disputes because the client already saw the hours.
- One source of truth for what is owed.

Note what is not a unique attribute: time tracking, invoice templates,
reports, mobile app. Every alternative has these. Copy that leads with them
is positioning against nothing.

**Who cares most**: owner-operators of 3-20 person firms billing hourly,
with 10+ active clients and at least one chronically late payer. They feel
the chasing cost personally. Larger firms have a finance person and a
collections process; they care less.

**Category**: "invoicing and payment collection for services firms", not
"time tracking" (Harvest owns it and it is not the value) and not
"accounts receivable automation" (an enterprise category whose buyers have
a finance team). Sub-positioning within invoicing: the one that gets you
paid.

**One-liner**: "Invoices from approved hours, and the follow-up handled.
Services firms get paid 11 days sooner on average." The number must come
from a real cohort analysis; if it does not exist yet, "and the follow-up
handled" carries the differentiator on its own.

## 6. Worked example: a consumer app

Product: a mobile app for recording and transcribing voice memos, with
on-device transcription (no upload), automatic summaries, and search
across everything said. Freemium, iOS first.

**Alternatives**: the built-in Voice Memos app (~50%; it is free and already
there), Otter.ai (~20%), Apple Notes typed by hand (~15%), nothing (~15%).

**Unique attributes**:
- On-device transcription: audio never leaves the phone. Otter uploads; the
  built-in app does transcribe on-device on recent iOS versions, so this is
  shared with one alternative. Keep it but do not lead with it alone.
- Search across the content of all recordings, with summaries. Built-in app
  search is by title; Otter has it but for uploaded audio.
- Works fully offline, including summaries (small on-device model).

**Value**:
- You can find the thing you said three weeks ago (the "nothing" and
  "built-in" person's pain: they record and never find it again).
- Private by construction, which matters to the therapist, lawyer and
  journalist segments found in reviews.
- Works on a plane, in a tunnel, in a basement.

**Who cares most**: people who talk to themselves for a living or a habit:
journalists, researchers, therapists writing session notes, founders who
think out loud on walks. They record frequently (5+ per week), need to
retrieve, and some have confidentiality constraints. Casual users of the
built-in app are not the target; they do not have the retrieval problem.

**Category**: "voice notes", not "AI transcription" and not "note-taking
app". "Voice notes" is what the target already calls the behaviour, and the
built-in app has trained the market to understand it; the product can then
be "voice notes you can actually find, that stay on your phone". Naming the
category "AI meeting assistant" would drag it into Otter's comparison,
where upload-based tools win on meeting features.

**One-liner**: "Voice notes you can search. Transcribed on your phone,
never uploaded." Not: "Capture your thoughts effortlessly with AI."

## 7. Choosing a market category

The category is the frame the customer uses to compare, so it decides
which attributes look like strengths. Three strategies:

**Join an existing category, compete on attributes.** "We are a project
management tool, and we are the one that is keyboard-first." Buyers
already understand the category, already budget for it, already search for
it. The cost: you inherit the category's feature checklist and will be
compared on things you deliberately lack. Right when the category is large,
growing, and the buyer searches by category name. This is the default for
small teams because it needs no education budget.

**Join an existing category, change the criteria.** "Project management
tools are judged on features. They should be judged on how fast the team
moves." You stay in the budget line but try to shift what matters to your
strength. Needs a credible argument and repeated content making it. Linear
did this. Right when the incumbents are bloated and the buyer is frustrated.

**Create a category.** "This is not project management; it is issue
velocity." Attractive to founders, almost always wrong for small teams:
category creation costs years of content, analyst relations and events, and
in the meantime nobody searches for the new term. Right only when the
product genuinely cannot be understood in any existing frame, and the team
has the resources to educate. Even then, start by anchoring to an adjacent
category ("like X, but for Y") until the new term has pull.

**Sub-category as the compromise.** Narrowing a category ("invoicing for
services firms", "feature flags for mobile", "CI for monorepos") gets most
of the benefits of category creation (you are the obvious choice within it)
without the education cost. For most products in this skill's audience,
this is the move.

Trade-offs to weigh explicitly:

| Decision | Favors | Costs |
|---|---|---|
| Broad category ("analytics") | Search volume, understood budget | Compared to giants on their checklist |
| Narrow sub-category ("product analytics for mobile games") | Obvious choice for the niche, cheaper to win | Smaller market ceiling, must re-position to grow |
| Adjacent anchor ("like Heroku for ML") | Instant comprehension | Inherits the anchor's reputation, good and bad; dates fast |
| New term | Ownership if it works | Years of education; nobody searches for it |

A category decision is also a search decision: whatever you call the
category is what you need to rank for, and `seo-content.md`'s keyword work
should confirm people actually search for it.

## 8. The positioning statement template

Write this for internal use. Never publish it; its job is to constrain the
copy, not to be the copy.

```
For [target customer, described by situation]
who [the trigger or pain that makes them look],
[product] is a [category or sub-category]
that [the primary value, in their words].
Unlike [the primary alternative],
it [the unique attribute(s) that produce that value],
which means [the consequence they care about].
We can prove this with [proof inventory].
We are not for [who should not buy, and why].
```

Filled in for the developer tool above:

```
For TypeScript backend teams on Postgres who write their own SQL
who have shipped a bug because their types drifted from the schema,
pgtypes is a type generator for Postgres
that gives you end-to-end type safety without adopting an ORM.
Unlike Prisma or hand-maintained types,
it generates from the live database (or your migrations) as a single
binary in CI,
which means your types cannot drift and you keep your SQL.
We can prove this with the bench/ results (0.8s on 200 tables), the
Postgres type coverage table in docs, and the three teams in
discussions/ who migrated from Prisma.
We are not for teams who want an ORM to own their queries; Prisma or
Drizzle will serve them better.
```

The "not for" line is the most useful line in the template. A product that
is for everyone is positioned against no one, and the line also produces
the most credible sentence on a landing page ("If you want an ORM, use
Prisma. If you want to keep your SQL, keep reading.").

## 9. Testing positioning cheaply

Positioning is a hypothesis. Test it before building a site around it.

**The five-second test.** Show the one-liner (just the sentence, no design)
to five people in the target group for five seconds, then ask: what is it,
who is it for, what does it replace? Three out of five getting all three is
a pass. Recruit from the places the target already is: a relevant Discord,
a subreddit, your own issue tracker, Twitter followers who match. This
costs an afternoon.

**The two-headline landing test.** Two versions of the hero (same page
otherwise) with different positioning, split traffic, measure signup rate.
Needs real traffic (see `analytics-and-growth.md` for sample sizes; with
200 visitors a week you will wait months). Cheaper variant: run the two as
separate X or LinkedIn posts with the same link and compare click-through;
it is noisy but directional.

**The sales conversation test.** In the next ten user conversations (or
support threads), say the positioning out loud and watch for the lean-in
or the glaze. Note which alternative they bring up unprompted. If they keep
naming an alternative you did not position against, your alternative list
is wrong.

**The search test.** Does anyone search for the category you chose? Use
Google autocomplete, the "People also ask" box, and Google Search Console
if the site exists. Zero search volume for your category term is a flag
against category creation.

**The competitor paste test.** Put your one-liner on a competitor's site in
your head. If it works there, it is not positioning; it is a description of
the category.

**The "why did you switch" interview.** Five short calls with recent
adopters: what were you using, what happened that made you look, what
almost stopped you, what would you tell a colleague. Their language is
better than yours; harvest it for copy. Record with consent.

## 10. Repositioning and pivots

Signals that positioning is wrong rather than copy: the right people visit
and do not sign up; the wrong people sign up and churn; users describe the
product in a way you did not intend ("oh, it's basically a backup tool");
sales conversations spend most of their time explaining what the product
is not.

Repositioning steps: re-run the method with current users as the data
source (what they actually use it for, what they came from), choose the
new frame, then update in this order: the README or product page one-liner,
the landing hero, the docs intro, the launch and social bios, the pricing
page's "who it's for" lines. Changing the hero without the README leaves two
contradictory descriptions live.

Do not reposition more than once a year unless the product itself changed.
Each change resets what the market has learned.

## 11. Failure modes

- **Positioning against the aspirational competitor** instead of the tool
  users actually have. Diagnostic: your comparison page is about a company
  your users have never used.
- **Leading with shared attributes.** Dashboards, integrations, "real-time",
  security, mobile app. If every alternative has it, it is table stakes and
  belongs in the "everything else" list, not the headline.
- **Attributes without the "so what".** "Built in Rust" is an attribute; a
  developer wants to know it means a 12MB binary that starts in 20ms.
- **Target customer by demography.** "SMBs", "developers", "Gen Z". None of
  these has a shared pain. A situation does.
- **Category creation by a team of two.** See section 7.
- **The one-liner that is a mission statement.** "Making data accessible to
  everyone" is a reason to exist, not a position. The position says what
  it is and what it replaces.
- **Publishing the template.** "For X who Y, Product is a Z that..." is
  internal scaffolding. On the page, render it as a headline, a subhead and
  a proof.
- **Refusing to exclude.** The "not for" line is where positioning
  becomes real. Skipping it produces copy for everyone.
- **Letting the model invent the alternative.** If the repo and the user do
  not tell you what the buyer uses today, ask. A guessed alternative yields
  confident, specific, wrong copy, which is worse than vague copy because
  it is harder to spot.
