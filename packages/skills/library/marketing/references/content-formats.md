# Content formats

Structures, full examples and judgment for the content formats a small
software team actually produces: case studies, comparison and "vs" pages,
tutorials, glossary and definition pages, video scripts, webinars and
talks, and a content calendar template that a two-person team can keep.
Search strategy for these formats is in `seo-content.md`; this file is
about how to make each one good.

## Contents

1. Choosing the format for the job
2. Case studies
3. Comparison pages and "vs" pages
4. Alternatives pages
5. Tutorials
6. Glossary and definition pages
7. Video: scripts and structure
8. Webinars and talks
9. The content calendar
10. Failure modes

## 1. Choosing the format for the job

| Reader's situation | Format | Why |
|---|---|---|
| Choosing between you and a named competitor | vs page | Answers the exact query; converts at decision time |
| Unhappy with an incumbent, surveying | Alternatives page | Catches the switcher early |
| Needs to believe it works for someone like them | Case study | Proof with a face and a number |
| Wants to accomplish a task with the product | Tutorial | Converts evaluators; ranks for how-to queries |
| Encountered a term and wants to understand it | Glossary page | Cheap topical authority; links into docs |
| Prefers to watch, or wants to see the product move | Video | Shows what text describes; long half-life on YouTube |
| Wants depth and a chance to ask | Webinar / talk | Builds trust; produces a recording and clips |
| Wants to know what changed | Changelog / release notes | See `developer-marketing.md` |
| Wants to learn something in the field | Deep-dive post | See `developer-marketing.md` and `seo-content.md` |

One piece, one job. A tutorial that keeps pausing to sell is a bad tutorial
and a bad sales page.

## 2. Case studies

A case study is a story with a number, told in the customer's words, that a
prospect in the same situation can see themselves in. It is the strongest
proof most small companies can produce, and most produce it badly: too long,
no number, written in the vendor's voice, no face.

**Getting one.** Ask the three most engaged customers, in a personal email,
for a 20-minute call. Say what you will produce (a one-page story, their
quote, their logo if permitted), that they approve everything before
publication, and what they get (a link, a mention in launch materials, early
access to something). Many say yes; the ones who say no are not offended.

**The interview** (record with consent; transcribe):
- What were you doing before? What was that like, specifically?
- What happened that made you look for something else?
- What else did you consider? Why not those?
- What almost stopped you from choosing us?
- How did the first week go? What broke?
- What's different now? Can you put a number on it?
- What would you tell a peer who is where you were?

Their answer to the second-to-last question is the headline. Their answer
to the last is the pull quote.

**Structure** (600-1,000 words; a one-screen summary at the top):

```
HEADLINE (the result, in their words or with their number)
  Flowstep cut invoice disputes from eight a month to one

SUMMARY BOX
  Who:      Flowstep, a 4-person product design studio in Berlin
  Before:   Harvest for time, invoices built by hand in Xero, founder
            chasing payment personally
  After:    Invoicely with client approval and automatic reminders
  Result:   Disputes 8/month to 1/month; average days-to-paid 31 to 14;
            founder's chasing time ~3h/week to ~0
  Quote:    "I haven't written a 'just following up on this invoice'
            email since March." – Miro Hahn, founder

THE SITUATION (150 words)
  Their world before, in concrete detail: the tools, the process, the
  specific failure. Their words where possible.

THE SEARCH (100 words)
  What they tried or considered and why they picked this. Name the
  alternatives if they are comfortable; it makes it credible.

THE SWITCH (150 words)
  How the first weeks went, including what was hard. A case study with
  no friction is not believed.

THE RESULT (150 words)
  The numbers, how they were measured, what changed day to day. One
  screenshot of the real thing if permitted.

IN THEIR WORDS (the pull quote, large)

WHAT'S NEXT (50 words, optional)
  What they plan to do with it; signals an ongoing relationship.

CTA (one line)
  "If you're a services firm chasing invoices by hand, Invoicely is
  $12/seat/month. Start free."
```

**A real-feeling example, condensed:**

> **Flowstep cut invoice disputes from eight a month to one**
>
> Flowstep is a four-person product design studio in Berlin billing
> roughly 40 client invoices a month. Until March, founder Miro Hahn
> built each one by hand from Harvest exports into Xero, then chased
> payment himself. "Every Friday afternoon was 'following up on this.'
> Some clients were 60 days late and I'd send the same email four times.
> And about twice a week someone would dispute hours they'd never seen
> until the invoice arrived."
>
> They looked at FreshBooks and at staying in Harvest with its invoicing
> add-on. "FreshBooks is fine but it's the same model: you send an
> invoice, you chase it. What I wanted was for the client to see the
> hours before the invoice existed."
>
> The first two weeks were not smooth. The Xero sync initially double-
> counted a credit note, and two clients ignored the approval emails
> entirely until Miro called them. "Ana fixed the credit note thing the
> same day. The clients just needed to be told once that this was the
> new process."
>
> By May, disputes were down from about eight a month to one. Days to
> payment dropped from 31 to 14, measured in Xero. "I haven't written a
> 'just following up on this invoice' email since March. The reminders
> go out whether I remember or not, and they're politer than mine were."
>
> Flowstep now uses the approval ledger in client renewals: "I can show
> them exactly what they approved and when. That conversation used to be
> a fight."

Why it works: a named person at a named company; specific numbers with
how they were measured; the friction is included; the alternatives are
named; the quotes sound like a person; the whole thing is under 300 words.

**Rules.** Get written approval of the final text and of logo use. Never
fabricate or "enhance" quotes; tidy grammar only, and confirm with them.
Numbers come from the customer or from your product data with their
permission; say which. Update or retire case studies when the customer
churns. Full rules in `claims-and-compliance.md`.

**Short forms.** A case study teaser for the landing page: logo, one-line
result, one sentence, a link. A quote card for social: the pull quote,
name, role, company, photo. A one-paragraph version for the sales email.
Make all three from the same interview.

## 3. Comparison pages and "vs" pages

The reader is choosing right now and knows the page is on your site.
Credibility is the entire strategy; one unfair row poisons the table.

**Structure:**

```
H1: pgtypes vs Prisma (2026)

TL;DR (80-120 words)
  Who should pick which. Say plainly when Prisma is the better choice.
  "If you want an ORM that owns your queries, migrations and types in
  one tool, use Prisma. If you write SQL (or use Kysely/Postgres.js)
  and want types that can't drift from production, pgtypes does one
  thing and stays out of the way."

AT A GLANCE (table, 8-12 rows)
  Rows are what the buyer cares about, not where you win:
  What it is | Query layer | Type source | Postgres-specific types |
  Other databases | Migrations | CI integration | Runtime dependency |
  Binary size / install | License | Pricing | Maintained by
  Facts only, with a date and source links. Mark "as of October 2026".

THE THREE DIFFERENCES THAT MATTER (150-250 words each)
  Each with the mechanism and a code sample or screenshot from both
  tools. Honest about trade-offs within each.

WHEN PRISMA IS THE RIGHT CHOICE (100 words)
  Real conditions, not strawmen.

WHEN PGTYPES IS THE RIGHT CHOICE (100 words)

PRICING (if applicable; worked examples at two sizes)

MIGRATING (if relevant; link to the guide)

FAQ (3-5 real questions)

CTA (one)
```

**Rules:**
- Every factual statement about the competitor is verifiable from their
  public docs or pricing at the time of writing, with a link. Re-verify
  quarterly; put the "last checked" date on the page.
- No disparagement; describe what they do, not what they fail at. "Prisma
  maps Postgres enums to TypeScript enums" is a fact; "Prisma's enum
  handling is broken" is an opinion that invites a legal letter and a
  rebuttal thread.
- Use their name; do not use their logo without checking their brand
  guidelines (most allow nominative use in text; many restrict logo use).
- Write it so that their users would say "that's fair". They will read it.
- The table rows are the buyer's criteria. If you have to invent a row to
  win it, you are losing the reader.

**Three-way and category comparisons** ("Prisma vs Drizzle vs Kysely vs
pgtypes") rank for broader queries and are harder to keep fair. Do one if
you can hold the standard; otherwise do the pairwise pages.

## 4. Alternatives pages

The reader is unhappy with X and surveying the field. Structure:

```
H1: 7 Prisma alternatives for TypeScript (2026)

Intro (100 words): why people look for alternatives to Prisma, from
real complaints (Reddit, GitHub issues, HN threads), linked. Not
invented grievances.

How we chose (50 words): the criteria.

For each alternative (6-10, including you, not necessarily first):
  Name and one-line description
  Best for (one line)
  Strengths (2-3 bullets, genuine)
  Trade-offs (1-2 bullets, genuine)
  Pricing / license
  Link

Summary table

Our take (100 words): which fits which situation; where you fit
honestly.

CTA (one)
```

Rules: include real alternatives, including ones better than you for some
users; the page is not believed otherwise. Describe each fairly. Update
when the landscape changes. Do not create one of these for every
competitor name you can think of; that is the programmatic-spam pattern
(`seo-content.md`).

## 5. Tutorials

A tutorial takes a reader from a known starting point to a working result,
teaching along the way. For a software product it is both documentation
and the most convincing marketing content there is, because it proves the
product does the thing.

**Structure:**

```
Title: the outcome, as the reader would search it
  "Generate TypeScript types from a Supabase database with pgtypes"

What you'll build (2 sentences + a screenshot or output sample of
  the finished state). The reader decides here whether to continue.

Prerequisites (bulleted; exact versions; time estimate)
  Node 20+, a Supabase project, 10 minutes

Steps (numbered; each with the command or code, then the expected
  output, then one or two sentences on what just happened and why)

  Step 1: Install
  Step 2: Get the connection string (with the gotcha: sslmode)
  Step 3: Generate
  Step 4: Use the types in a query
  Step 5: Add the CI check

Troubleshooting (the 3-4 errors people actually hit, with fixes)

What's next (2-3 links: the deeper guide, the related tutorial,
  the reference)
```

**Rules:**
- Test it on a clean machine, following your own text literally. Every
  tutorial that has not been tested has a broken step.
- Show expected output after every command; the reader needs to know
  whether they are on track.
- One path. Tutorials that branch ("if you're using X, do this; if Y, do
  that") become reference docs. Write two tutorials.
- Explain the why in one sentence per step; a tutorial with no explanation
  is a script, and the reader learns nothing.
- Name the gotchas before the reader hits them.
- No marketing inside. The tutorial is the marketing.
- Keep it current: pin versions, date it, and re-test when the product
  changes. A broken tutorial is remembered.
- Length: as long as the steps need; 1,000-2,500 words typical. Do not pad
  with background; link to it.

## 6. Glossary and definition pages

Definition pages ("What is schema drift?") rank for informational queries,
build topical authority for a cluster, and give you a page to link to from
docs and posts whenever the term appears. They are also the first thing AI
overviews absorb, so expect low click-through; their value is authority
and internal linking more than traffic.

**Structure** (300-700 words):

```
H1: What is schema drift?

Definition (40-60 words, directly, as the quotable answer)
  Schema drift is the gap that opens between a database's actual schema
  and what the code expects it to be: a column renamed in a migration
  the types never learned about, an enum value added by hand in
  production. The code compiles; the query fails at runtime.

Why it happens (100-150 words)
How it shows up (100 words; concrete symptoms)
How to prevent or detect it (150 words; honest about the approaches,
  including ones that are not your product)
Related terms (links within the cluster)
Where this comes up in [product] (one paragraph, linked to docs)
```

Rules: write each one; do not generate them from a template with the term
swapped. Only define terms your ICP actually searches or encounters in your
docs. Link each from the docs where the term appears. Five good definition
pages beat fifty thin ones.

## 7. Video: scripts and structure

Video shows what text describes. For software, three forms matter: the
product demo (60-120 seconds, on the landing page and in launch posts), the
tutorial walkthrough (8-20 minutes, YouTube), and the short clip (15-60
seconds, social).

**The 90-second demo script:**

```
0:00-0:05  The problem, one sentence, over the before state on screen.
           "Your Postgres schema changed. Your TypeScript types didn't."
0:05-0:15  What this is, one sentence, product appears.
           "pgtypes generates the types from the live schema."
0:15-0:60  The product doing the thing. Real terminal, real schema,
           real output. Cursor visible, typing at human speed or slightly
           faster. Caption the key moments; no voice needed if captions
           carry it, but a plain voice is fine.
           Beat 1: the command runs, types appear (10s)
           Beat 2: a column is renamed in the DB, CI fails with the
                   exact error (20s)
           Beat 3: regenerate, commit, CI passes (15s)
0:60-0:80  One differentiator shown, not told. The enum becoming a
           string union, on screen.
0:80-0:90  The one-liner on screen, the install command, the URL.
           No "like and subscribe". No music swell.
```

Rules: show the real product with real data; no logo animation intro; no
stock music if you can avoid it (a quiet track is fine); captions always
(most social video is watched muted); 1080p minimum; cursor visible;
aspect ratio per destination (16:9 landing page and YouTube; 9:16 or 1:1
for social); total length is as short as the demonstration allows.

**The tutorial walkthrough (YouTube):**
- Title is the query plus the outcome: "Postgres to TypeScript types in 10
  minutes with pgtypes (with CI check)"
- First five seconds: show the end result. "By the end of this, your CI
  will fail when your types drift. Here's what that looks like." Then
  start.
- No intro longer than ten seconds; no "hey guys welcome back".
- Chapters in the description (YouTube uses them; viewers skip to the
  step they need).
- Screen recording with clear audio beats a face camera with bad audio.
  A small face-cam inset is fine if the audio is good.
- Mistakes left in and corrected are fine and often appreciated; a long
  pause is not.
- End with the next thing to watch or read, not with a request to
  subscribe.
- Thumbnail: the outcome, large text (3-5 words), high contrast; no
  shocked face.

**The short clip (15-60 seconds):** one beat from the demo or walkthrough,
captioned, with a text hook in the first second ("Your types are lying to
you"), ending on the result. Repurpose from the longer video; do not shoot
separately.

## 8. Webinars and talks

**Webinars** for a small team are a stretch; they need an audience to
invite. Worth doing when you have a list of a few hundred engaged users or
a partner with an audience who will co-host. Format that works: 20 minutes
of real content (a technical walkthrough, a customer showing their setup),
20 minutes of questions, recorded, published within a day with chapters.
Not a sales presentation; nobody attends those twice.

**Talks** (meetups, conference lightning talks, podcasts) are more
accessible and produce a recording with a long life. Submitting to CFPs:

- Title is a specific claim or question, not the product name. "What
  every ORM gets wrong about Postgres enums" gets accepted; "Introducing
  pgtypes" does not.
- Abstract states the problem, what the audience will learn, and why you
  are the one to teach it (you built the thing that hit the problem).
- The talk teaches; the product appears as the example, once or twice,
  honestly. Audiences punish disguised pitches and reward depth.
- Structure for a 20-minute talk: the problem with a real story (3 min),
  why it happens (5 min), the approaches and their trade-offs (8 min), what
  we did and what we learned (3 min), the one takeaway (1 min).
- Slides: few words, big type, real code, real screenshots. One idea per
  slide.
- Record your own audio as a backup; conference recordings are often late
  or missing.
- After: publish the slides, a written version of the talk (ranks and gets
  read), and three clips.

**Podcasts** as a guest: pitch hosts in the niche with a specific angle
(a story, a contrarian take, numbers), not "I'd love to talk about my
company". Prepare three stories you can tell well. Send the host a one-
paragraph bio and the links you want mentioned.

## 9. The content calendar

A calendar a small team can actually keep. The constraint is production
capacity, not ideas; plan to it.

**Capacity first.** How many hours a week can go to content, honestly?
Four hours a week supports roughly: one long-form piece a month, one
substantive social post a week, daily short posts, a monthly email. Plan
that, not more.

**The template** (a spreadsheet or a markdown table in the repo):

| Week | Long-form | Primary query / job | Format | Derivatives | Owner | Status | Published | Result (30d) |
|---|---|---|---|---|---|---|---|---|
| Oct 6 | Postgres enums in TypeScript: three approaches | postgres enum typescript | Deep dive | Thread (Oct 8), 3 posts, newsletter item, docs link | Ana | Draft | | |
| Oct 13 | (none; launch week) | | | Launch thread, Show HN, PH | Both | Planned | | |
| Oct 20 | Flowstep case study | proof for landing page; "invoicing for design studios" | Case study | Quote card, teaser on landing, sales snippet | Jonas | Interview done | | |
| Oct 27 | October changelog | retention | Email + post | Carousel | Ana | | | |
| Nov 3 | pgtypes vs Prisma | pgtypes vs prisma; prisma alternative | vs page | Table image, thread | Ana | Brief | | |

**Rules for the calendar:**
- Every long-form entry has a job (a query, a proof need, a launch) from
  `seo-content.md` or the launch plan; nothing is written because the
  slot was empty.
- Derivatives are scheduled, not hoped for (see the repurposing pipeline
  in `social-and-community.md`).
- The "Result" column is filled in 30 days later: clicks, signups,
  rankings, replies. The calendar is also the learning log.
- A quarter is planned at a time; the current month is firm, the next two
  are sketched.
- One slot a month is reserved for reactive content (something that
  happened, a thread that blew up, a competitor change).
- When capacity drops (a release crunch), cut the calendar; do not let it
  slip silently. A visibly skipped month with a reason is fine; a calendar
  that is always behind is demoralizing.

**Quarterly review:** which formats produced signups, which queries
ranked, which posts got replies from the ICP. Shift the next quarter's mix
toward what worked. Kill formats that produced nothing twice.

## 10. Failure modes

- **Case studies with no number, no name and no friction.** "A leading
  company improved efficiency." Nobody believes it; nobody should.
- **Case study in the vendor's voice.** The customer's words are the asset;
  do not paraphrase them into marketing.
- **Unfair comparison tables.** Rows chosen to win; competitor facts wrong
  or stale. The reader notices, the competitor notices, the page fails at
  both jobs.
- **Alternatives pages with one real alternative (you).** Does not rank,
  does not convert.
- **Untested tutorials.** Step 4 does not work; the reader concludes the
  product does not work.
- **Tutorials that branch.** Write two.
- **Glossary pages generated from a template.** Thin content; sitewide
  penalty risk.
- **Demo videos that start with a logo animation.** Five seconds of
  nothing; viewers leave.
- **Talks that are pitches.** Not accepted; if accepted, not forgiven.
- **A calendar planned to ambition rather than capacity.** Behind by week
  three; abandoned by week eight.
- **Content with no job.** Written because the slot was empty; measured by
  nothing; teaches nothing.
