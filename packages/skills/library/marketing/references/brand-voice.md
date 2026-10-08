# Brand voice

How to find the voice a product already has, write it down so that anyone
(including an agent) can reproduce it, flex it by context without losing
it, and keep it consistent across contributors. Covers extraction from
existing material, a voice guide template with traits, do/don't pairs and
sample sentences, tone shifts by context, and the mechanics of maintaining
voice when several people write.

## Contents

1. What voice is, and why small teams need it written down
2. Extracting voice from existing material
3. Deciding the voice when there is almost nothing
4. The voice guide template
5. A filled-in example
6. Tone shifts by context
7. Voice for different authors: founder, product, support, docs
8. Maintaining voice across contributors
9. Voice and the agent
10. Failure modes

## 1. What voice is, and why small teams need it written down

Voice is the consistent personality in everything a company writes: the
words it chooses, the sentence length it favours, what it jokes about and
what it never jokes about, how it treats the reader. Tone is how that voice
flexes for a context (a launch post is warmer than an error message). A
product with a consistent voice feels like one entity; a product whose
hero, docs, emails and error messages were written by four different
people in four registers feels like nobody is home.

Small teams often have a strong voice by accident: the founder's. It is in
the README, the commit messages, the replies on GitHub. The problem comes
when a second writer, a contractor, or an agent starts producing copy and
reaches for the generic register because the real one was never written
down. The guide exists so that the voice survives the founder not writing
every word.

## 2. Extracting voice from existing material

Before writing a guide, read everything the team has written, in this
rough order of signal:

1. **The README and docs intro.** Usually the most considered prose.
2. **The changelog.** Shows how they talk about their own work: terse or
   expansive, dry or enthusiastic, whether they credit people.
3. **Issue and discussion replies.** The unguarded voice: how they treat
   users, how they handle being wrong, how formal they are.
4. **Existing site or landing copy.** Often the least representative,
   because it was written "as marketing"; note where it diverges from 1-3,
   and treat 1-3 as the truth.
5. **Social posts and launch threads.** The founder's public register.
6. **Emails they have sent** (support, onboarding, newsletter). The voice
   in one-to-one.
7. **Error messages and UI strings.** Whether the personality reaches into
   the product.
8. **The conversation with you.** How the user talks about their product
   is data.

For each source, note:

- **Sentence length and rhythm.** Short and clipped? Long and explanatory?
  Mixed?
- **Vocabulary.** Technical precision or plain words? Any recurring phrases
  ("the boring way", "no magic")? Any words they never use?
- **Person and address.** "We" or "I"? "You" or "users"? Direct address or
  third person?
- **Formality markers.** Contractions? Slang? Full sentences in commit
  messages?
- **Humour.** Present? What kind (dry, self-deprecating, absurdist)? Where
  it appears and where it does not?
- **Stance toward the reader.** Peer, teacher, servant, authority?
- **Stance toward competitors.** Named? Respected? Ignored? Mocked?
- **Confidence register.** Hedged ("we think this might") or declarative
  ("this does X")?
- **Treatment of limitations.** Hidden, mentioned, or foregrounded?
- **Punctuation and formatting habits.** Em dashes, semicolons, parentheses,
  bullets, code in prose, emoji.

Then write three sentences in their voice and three that are wrong, and
check them against the sources. If you cannot tell them apart, read more.

Quote actual sentences from the material in the guide. Real examples beat
descriptions; "terse and dry" is interpreted ten ways, but "Fixed. Sorry
about that. (#212)" is unambiguous.

## 3. Deciding the voice when there is almost nothing

A pre-launch product may have a README and nothing else. Derive the voice
from three inputs:

- **The audience** (from positioning): what register do they trust? Backend
  developers trust terse and precise; small business owners trust plain and
  warm; designers trust considered and slightly opinionated.
- **The product's character**: a security tool should not be playful; a
  consumer habit app should not be austere; a developer tool with
  opinionated defaults can be opinionated in its prose.
- **The founders**: how they actually talk, from the conversation and any
  public writing. A voice they cannot sustain in a reply thread is not
  theirs.

Propose a voice (traits, three sample sentences) and ask the user to react.
"Does this sound like you?" gets a better answer than "what should the
voice be?"

## 4. The voice guide template

Keep it to one or two pages. Guides nobody reads do not maintain anything.

```
# [Product] voice guide

## Who we're talking to
One paragraph: the reader, their situation, what they trust and distrust.

## Voice in one sentence
"[Product] sounds like [a specific kind of person] explaining [a specific
kind of thing] to [a specific kind of peer]."

## Traits (3-4), each with a sentence of what it means and a boundary
- Trait: what it means here. Not: the failure mode of too much of it.

## We say / we don't say
A table of 8-15 pairs: a sentence in our voice and the same idea in the
wrong voice, with a word on why.

## Vocabulary
- Words we use: (domain terms, our names for things, verbs we favour)
- Words we avoid: (and why; usually hype, hedging, or corporate)
- Names: how we write the product name, features, competitors, ourselves

## Mechanics
- Person (we/I; you)
- Contractions (yes/no)
- Sentence length tendency
- Punctuation habits (em dashes, exclamation marks, semicolons, emoji)
- Capitalization (sentence case everywhere? Title Case for features?)
- Numbers (numerals vs words; units)
- Code and technical terms in prose (backticks? how much?)
- Humour: where allowed, what kind, where never

## Tone by context
A short table: context → how the voice flexes (see section 6)

## Sample sentences
Six to ten real or realistic sentences across contexts that are
unmistakably us.

## Last updated / owner
```

## 5. A filled-in example

For the Postgres type generator used throughout these references.

```
# pgtypes voice guide

## Who we're talking to
TypeScript backend developers who chose to write SQL. They are precise,
skeptical of tooling that wants to own their stack, allergic to hype,
and appreciate being told the limits up front. They read docs before
marketing and GitHub issues before docs.

## Voice in one sentence
pgtypes sounds like a senior backend engineer explaining a tool they
built to a colleague they respect: direct, specific, a little dry,
unbothered about selling.

## Traits
- Direct: say the thing in the first sentence. Not: blunt to the point
  of rudeness with users who are stuck.
- Specific: numbers, versions, names, units. Not: so detailed that the
  one-liner needs a footnote.
- Dry: humour is understatement and the occasional aside, never a joke
  that needs a setup. Not: sarcasm about users or competitors.
- Candid: limitations and mistakes stated plainly, before anyone asks.
  Not: self-deprecation as a habit; we're confident in what it does.

## We say / we don't say
| We say | We don't say | Why |
|---|---|---|
| TypeScript types from your live Postgres schema. | Unlock type-safe database access. | Says what it does; no intensifier |
| Postgres only. MySQL is not planned. | Supports all major databases (coming soon). | Candid beats aspirational |
| 0.8s on a 200-table schema. | Blazing fast. | Number over adjective |
| If you want an ORM, use Prisma. It's good. | Unlike legacy ORMs... | Respect for alternatives; we're confident, not defensive |
| Fixed. Sorry about that. (#212) | We've resolved an issue affecting some users. | Direct, owns it, cites it |
| Run `pgtypes gen`. You'll get a `types.ts`. | Simply run the generate command to effortlessly produce your types. | No "simply", no "effortlessly" |
| We built this after a column rename took down prod. | We're passionate about developer productivity. | Specific story over abstract value |
| This is a type generator. It doesn't write queries. | A complete database toolkit. | Say the category; don't inflate it |
| Thanks for the repro; that made it a ten-minute fix. | Thank you for your feedback! | Specific gratitude; no exclamation |
| Views are supported as of 0.4. Materialized views too. | Exciting news: view support is here! | Changelog is facts |
| It phones home exactly never. Here's the network call list. | We take your privacy seriously. | Verifiable over reassuring |
| We're two people. Replies take a day, sometimes two. | Our dedicated support team is here 24/7. | True beats impressive |

## Vocabulary
- We use: generate, schema, drift, types, CI, Postgres (not PostgreSQL in
  prose, not "PG"), live database, migrations directory, single binary
- We avoid: solution, platform, powerful, seamless, leverage, robust,
  modern, simply, easily, blazing, AI-powered, ecosystem, journey
- Names: pgtypes (lowercase, always, even at sentence start). Prisma,
  Drizzle, Kysely by their own capitalization. "We" for the team; "I" when
  one founder signs.

## Mechanics
- First person plural; direct second person.
- Contractions: yes.
- Sentences: short by default; one longer explanatory sentence where
  mechanism needs it. Paragraphs under four sentences.
- Punctuation: periods. Colons for "here's the thing: thing". Parentheses
  for asides. Em dashes rarely. Exclamation marks never. Semicolons
  sparingly. No emoji anywhere.
- Sentence case for everything including headings and feature names.
- Numerals always (0.8s, 200 tables, 3 teams). Units attached.
- Code in backticks in prose; commands as code blocks.
- Humour: dry asides in changelogs, posts and replies. Never in error
  messages, pricing, security or incident communication.

## Tone by context
| Context | Flex |
|---|---|
| Landing hero | Most declarative. No asides. |
| Docs | Warmer by one notch; patient; still terse. |
| Changelog | Flattest. Facts, numbers, credits. One dry line allowed. |
| Launch post / thread | Most personal. First person singular OK. The story. |
| Issue replies | Peer to peer. Thank for repros. Own mistakes fast. |
| Error messages | No personality. What happened, what to do. |
| Pricing | Plain. Arithmetic done for them. No jokes. |
| Incident | Direct, timestamps, no spin, no apology theatre. |
| Win-back email | Human, short, no guilt. |

## Sample sentences
- TypeScript types from your live Postgres schema. Keep your SQL.
- Reads the database or a migrations folder; writes one file; runs in CI
  in under a second.
- Postgres only. If you're on MySQL, Kysely's codegen is the one to look
  at.
- 0.4.0 broke enums with trailing commas. 0.4.1 fixes it. Sorry.
- If you want an ORM, use Prisma or Drizzle. pgtypes is for people who
  decided not to.
- We're two people in Lisbon and Toronto. Reply to this email and one of
  us reads it.
- Your types can't drift now. Here's the CI step.
- It phones home exactly never.

Last updated: 2026-10 · Owner: Ana
```

## 6. Tone shifts by context

Voice holds; tone flexes. The flex is mostly along three axes: warmth
(how much the reader's feelings are acknowledged), personality (how much
of the voice's character shows), and density (how much per sentence).

| Context | Warmth | Personality | Density | Notes |
|---|---|---|---|---|
| Landing hero | Low-medium | Medium | Very high | Every word carries |
| Feature sections | Medium | Medium | High | Mechanism plus proof |
| Pricing | Low | Low | High | Clarity is the kindness |
| Docs tutorial | Medium-high | Low-medium | Medium | Patient; anticipates confusion |
| Docs reference | Low | None | Very high | Facts |
| Changelog | Low | Low (one dry line) | Very high | |
| Launch post | High | High | Medium | The story; first person |
| Social | Medium-high | High | Medium | Conversational |
| Onboarding email | High | Medium | High | Short, personal, one action |
| Error message | Medium | None | High | Calm; what to do |
| Empty state | Medium-high | Low-medium | Medium | Design's domain; voice informs |
| Incident / outage | Medium | None | High | Direct; timestamps; no spin |
| Apology | High | None | Medium | Specific about what went wrong |
| Legal / privacy | Low | None | High | Plain language is still the voice |
| Win-back | High | Low | Medium | No guilt, no discount by default |
| Support reply | High | Low-medium | Medium | Solve, then warmth |

The test of tone: read the hero and the error message back to back. Same
company? If the hero is dry and specific and the error says "Oops!
Something went wrong 😅", one of them is wrong (it is the error).

## 7. Voice for different authors: founder, product, support, docs

Several people write for one product. The voice is shared; the author's
identity can show within it.

- **Founder posts and emails** signed by a person use "I", carry the most
  personality, tell stories. The guide's voice is the baseline; the
  founder's own idiom sits on top. Do not sand it off.
- **Product copy** (site, pricing, in-app) uses "we", the voice at its
  most disciplined.
- **Support replies** use "I" (a named human), warmth up, personality down,
  solve first.
- **Docs** use "you" and the imperative, personality near zero, warmth in
  anticipating confusion rather than in friendliness.
- **Changelog and release notes** are the flattest and most factual; one
  dry line is the personality budget.

An agent writing for a founder should read that founder's own posts and
match their idiom, not just the guide; the guide is the floor.

## 8. Maintaining voice across contributors

- **The guide lives in the repo** (`docs/voice.md`, `brand/voice.md`, or
  wherever the team keeps conventions) and is linked from CONTRIBUTING and
  from the marketing site's README. Not in a Notion page nobody opens.
- **Review copy like code.** Site copy, emails and release notes go
  through a PR; the reviewer checks against the guide's "we say / we
  don't" table and the banned vocabulary. A lint step can grep for banned
  words (`scripts/` is optional; a one-line `grep -E` in CI does it).
- **A sentence bank grows.** When a contributor writes a line that is
  perfectly in voice, add it to the sample sentences. When one is perfectly
  wrong, add it to the "we don't say" column. The guide gets better by
  accretion.
- **One owner.** Someone decides edge cases. Voice by committee drifts
  toward beige.
- **Templates carry voice.** The changelog template, the email templates,
  the issue reply snippets: if the templates are in voice, most contributed
  text will be.
- **Revisit yearly or on repositioning.** Voice shifts as the audience or
  stage changes (a pre-launch "we're two people" line is wrong at fifty
  people). Update the guide deliberately, not by drift.
- **Onboard writers with the three-sentence test.** New contributor writes
  three sentences about the product; compare with the guide; discuss. Ten
  minutes, prevents months of drift.

## 9. Voice and the agent

When the agent writes in a product's voice:

1. Read the sources in section 2 before writing anything. If a guide
   exists, read it; if not, extract the voice and (if the task is large)
   propose a one-page guide as a by-product.
2. Write, then put a paragraph of yours beside a paragraph of theirs. Same
   person? If not, revise toward theirs.
3. Watch for the agent's default register overriding theirs: the generic
   register is confident, polished, slightly warm, triadic, em-dash-heavy,
   and ends paragraphs on a punchy fragment. If their voice is terse and
   flat, the output should be terse and flat, even if it feels
   under-written.
4. When their voice has a flaw (hedging, buried leads, hype), fix the flaw
   while keeping the voice. "Sharper version of them" is the goal; "my
   version instead" is the failure.
5. Deliver copy with a one-line note on voice choices where you deviated
   from existing material and why.

## 10. Failure modes

- **Writing the guide from aspiration, not evidence.** "Bold, playful,
  human" for a team whose every real sentence is dry and terse.
- **Adjective-only guides.** "Friendly, professional, approachable" means
  nothing without sample sentences and don't-say pairs.
- **Voice that cannot flex.** Jokes in error messages; hero copy in the
  changelog.
- **Voice that flexes into a different company.** Dry on the site, "Hey
  there! 🎉" in the onboarding email.
- **Borrowed voice.** A two-person tool written in Stripe's register, or
  Linear's. The audience notices the costume.
- **The agent's default register winning.** Polished, triadic,
  em-dash-heavy, slightly warm; recognizable; not theirs.
- **Guide in a place nobody looks.** Put it in the repo.
- **Nobody owns it.** Drift to beige.
- **Humour without a budget.** One dry line per changelog is a style; a
  joke per paragraph is a brand nobody trusts with their database.
