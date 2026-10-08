# Copy review

A structured critique pass for existing copy, including the agent's own
first draft. Eight lenses (clarity, specificity, proof, audience fit,
voice, CTA, scannability, claims risk), a scoring rubric, how to deliver
edits so the author learns rather than just accepts, and a catalogue of the
tells that mark copy as machine-written, with how to remove each.

## Contents

1. When and how to run a review
2. The eight lenses
3. The scoring rubric
4. The pass, in order
5. Delivering edits
6. AI-copy tells and how to remove them
7. Reviewing specific asset types
8. Reviewing your own draft
9. Failure modes of reviewers

## 1. When and how to run a review

Run the pass on: any copy the user asks you to improve ("make this sound
better", "review our landing page"), any copy you wrote before handing it
over, and existing copy you encounter while doing something else if it
would embarrass the product (mention it; do not silently rewrite).

Before reviewing, know three things: who the reader is (from positioning
or the user), what the asset's one job is, and what the existing voice is
(from the repo). A review without these produces generic edits that make
every page sound the same.

Read the copy once as the reader, fast, on the device they would use (a
phone for email and social; a laptop at 1440 for a landing page, then at
360). Note where you stopped, skimmed or doubted. Then run the lenses.

## 2. The eight lenses

Each lens is a question with a diagnostic and a typical fix.

**1. Clarity.** Does a reader in the target group understand what this is
and what it does after the first sentence or two?
Diagnostic: cover everything but the headline and subhead; say aloud what
the product is. If you cannot, or you say something vague ("some kind of
platform"), clarity fails.
Fix: replace the mission or metaphor with the category noun and the
differentiator.

**2. Specificity.** Could a competitor paste this unchanged?
Diagnostic: for each claim, swap in a competitor's name. If it still works,
the sentence has no information.
Fix: replace the adjective with the number, the category word with the
concrete noun, the generic situation with the real one. See
`messaging-and-copy.md` section 4.

**3. Proof.** Does every claim have a source, a mechanism or a visible
artifact next to it?
Diagnostic: list every claim (anything with a comparative, a number, a
result, or an adjective). For each: where would a skeptic look to check it?
Fix: add the source; rewrite as a mechanism description; or cut. Invented
testimonials or statistics are a stop-the-review finding.

**4. Audience fit.** Does the target reader recognize their situation,
their current tool, their vocabulary, in the first screen?
Diagnostic: read sentence one as the ICP. Is it about them, or about the
company, or about everyone?
Fix: name the situation, the alternative, the role, in their words
(sourced from issues, forums, support).

**5. Voice.** Does this sound like the same entity as the README, the docs
and the existing site? Does it sound like a company of this size and
stage?
Diagnostic: put a paragraph beside one from the existing material. Same
person? Would a two-person team actually say this?
Fix: toward the existing voice, per `brand-voice.md`. If the existing
voice is the problem, say so separately; do not fix it by stealth.

**6. CTA.** Is there one primary action; does it name what happens next;
does it fit the reader's state?
Diagnostic: how many buttons and links compete? What does the main one
say? Would a stranger click it?
Fix: one primary, verb plus object, a click trigger for the top objection;
secondary as a text link for the not-ready reader.

**7. Scannability.** Can a reader who reads only the headings, bolds and
first sentences get the argument?
Diagnostic: read only those. Does it hang together? Are the headings
feature names (bad) or statements (good)?
Fix: headings as claims; first sentences carry the paragraph; paragraphs
under four sentences; lists for lists, prose for arguments.

**8. Claims risk.** Does anything here create legal or trust exposure?
Diagnostic: search for best, fastest, only, #1, free, guaranteed, any
percentage, any customer name or logo, any competitor name, any star
rating, "trusted by", health or financial outcome words.
Fix: per `claims-and-compliance.md`; substantiate, soften to a true
statement, or remove.

## 3. The scoring rubric

Score each lens 1-4. The scores are for prioritizing edits and for showing
the author where the problems are, not for grading them.

| Score | Meaning |
|---|---|
| 4 | No issues; a model example |
| 3 | Minor issues; one or two edits |
| 2 | Real problems; the lens fails in places that matter |
| 1 | The lens fails fundamentally; rewrite this dimension |

Weighting by asset: for a landing hero, clarity, specificity and CTA carry
most. For a case study, proof and audience fit. For an email, CTA, voice
and clarity. For a Show HN post, voice (register), specificity and proof.
For a pricing page, clarity and claims risk. Report scores with the one
sentence that justifies each; a number without a reason teaches nothing.

A total under 20 of 32 usually means the structure is wrong, not the
sentences; propose a re-outline before line edits. A total over 26 means
line edits will do.

## 4. The pass, in order

1. **Read as the reader** (fast, on their device). Note stops and doubts.
2. **Job and reader check.** State in one line what this asset is for and
   who it is for. If you cannot from the copy alone, that is finding one.
3. **Structure.** Is the section order the reader's question order (see
   `landing-page-conversion.md` section 2)? Is anything missing (the "not
   for", the objection, the proof)? Is anything there that serves no
   question?
4. **Lenses 1-8**, scoring each with a one-sentence reason.
5. **Claims list.** Every claim, with its status: sourced / mechanism /
   unsupported / risky.
6. **AI-tell scan** (section 6). Count em dashes, triads, "not X but Y"
   constructions, punchy paragraph endings.
7. **Read aloud.** Mark every stumble.
8. **Prioritize.** Top three findings by impact on the asset's job. Fixing
   the hero's clarity matters more than twelve good line edits.
9. **Edit** (section 5).
10. **Re-read the edited version as the reader.** Confirm the job is now
    done. Confirm you did not flatten the voice.

## 5. Delivering edits

The author should understand each change well enough to make the next one
without you. Deliver:

**A summary** (3-5 lines): the asset's job as you understood it, the
overall score, the top three findings, and the one change that would
matter most if they do nothing else.

**The findings** as a table or list, each with: location, lens, what is
wrong in one sentence, the proposed rewrite, and the reason. Rationale is
the part that teaches; never deliver a rewrite without it.

```
| Where | Lens | Issue | Rewrite | Why |
|---|---|---|---|---|
| Hero H1 | Clarity, specificity | "Build faster with confidence" says nothing a competitor couldn't | "TypeScript types from your live Postgres schema" | Names input, output, mechanism; fails the paste test (good) |
| Hero sub | Proof | "Trusted by thousands" unverifiable at 2,400 stars | "2,400 GitHub stars. 14 teams in production that we know of (Oct 2026)." | Dated, checkable numbers |
| Section 2 H2 | Scannability | Heading is the feature name ("Real-time regeneration") | "Your types can't drift" | Heading as the claim; feature in the body |
| Section 3 | Claims | "the fastest Postgres type generator" with no benchmark | "0.8s on a 200-table schema (bench/)" | Comparative claim needs comparison data; absolute number with source is safer and stronger |
| CTA | CTA | "Get started" and "Learn more", equal weight | Primary "Install in 30 seconds"; secondary text link "Compare to Prisma" | One action, named; second for the not-ready reader |
```

**The rewritten version** in full, if the user asked for one, with changes
visible (a diff, or the old line struck through above the new one, or a
side-by-side table for short copy). Never deliver only the clean version
for a review; the author cannot see what changed or why.

**What you did not change and why.** If something looks like an error but
is a deliberate voice choice (a terse fragment, a lowercase product name),
say you kept it on purpose. If the existing voice has a flaw you did not
fix because it is theirs to decide, say so.

**Tone of the review.** Direct, specific, about the copy and not the
writer. "This headline doesn't say what the product is" rather than "you
failed to communicate". Praise what works, specifically, once; it tells
them what to keep.

## 6. AI-copy tells and how to remove them

Copy produced by a model (including by this agent) has recognizable
textures. Readers have learned them, and they now read as low-effort even
when the content is good. Scan for each; the fix is next to it.

| Tell | Why it reads as machine | Fix |
|---|---|---|
| Em dashes as the default joiner, several per paragraph | Overrepresented in generated text; now a flag | Period, comma, colon, or restructure; aim for at most one per 200 words |
| Tidy triads everywhere ("fast, reliable, and secure"; three bullet points under every heading) | Rhythm filler; the third item is there for cadence | Two items or four; cut the weakest; vary list lengths |
| "It's not X. It's Y." / "Not just X, but Y." / "X isn't about A. It's about B." | A template of false contrast, repeated | State Y directly |
| Every paragraph ends on a short punchy fragment. Like this. | Cadence pattern, not content | Let some paragraphs end mid-thought or on a long sentence |
| Rhetorical question then answer, section after section ("Why does this matter? Because...") | Template structure | Mostly state; one question per page at most |
| "Whether you're a X or a Y" | Writing for everyone | Name the one reader |
| "In today's fast-paced..." / "In an era of..." / "In the world of..." | Throat-clearing openers | Delete; start with the point |
| "Let's dive in" / "Let's explore" / "Let's unpack" | Filler transitions | Delete |
| "Here's the thing:" / "The truth is:" / "Here's why:" | Fake intimacy before a claim | Make the claim |
| Stacked intensifiers ("truly", "genuinely", "incredibly", "deeply") | Compensating for missing specifics | Delete the adverb; add the fact |
| "Seamlessly", "effortlessly", "robust", "leverage", "elevate", "empower", "unlock", "harness", "supercharge", "game-changing", "cutting-edge" | The marketing-filler lexicon | See the ban list in `messaging-and-copy.md` |
| "Delve", "tapestry", "landscape" (abstract), "realm", "navigate (a problem)", "journey", "testament to", "a nod to", "underscores", "pivotal", "crucial" | Vocabulary overrepresented in generated prose | Plain alternatives: explore → look at; landscape → market/field; journey → process or delete |
| Perfectly parallel structure in every list and every heading | Humans vary; templates do not | Break the parallel where the content wants to |
| Abstract nouns doing the work ("innovation", "efficiency", "productivity", "experience", "solutions") | Avoids saying what actually happens | The concrete noun or the verb |
| Hedged then asserted ("While X can be challenging, Y makes it simple") | A template for false balance | State Y with its mechanism |
| Summaries that restate ("In summary, as we've seen...") | Padding | Cut; or end on the one takeaway, new words |
| Numbered 01 / 02 / 03 section markers on non-sequential content | Design tell with a copy cause: everything made into "steps" | Headings as claims; numbers only for sequences |
| Persona fiction ("Meet Sarah, a 34-year-old marketing manager who...") | Invented specificity | The situation, the tool they use, the trigger, from real data |
| Invented statistics ("Teams save 10+ hours a week") | No source; a legal issue | Source or cut; mechanism instead |
| Over-warm sign-offs ("We can't wait to see what you build!") | Enthusiasm the writer cannot feel | Plain close; the next step |
| Emoji in headings or as bullets (B2B/dev) | Consumer register borrowed | Plain bullets |
| Perfectly balanced pros and cons, always two of each | Template fairness | The real count, even if lopsided |
| Everything explained; nothing assumed | The model does not know the reader; a human would | Cut what the ICP already knows |
| No specific nouns from this product, this repo, this codebase | The copy was written from the category, not the thing | Go back to the truth sheet; add the real names |

The meta-fix: machine texture comes from generating plausible text rather
than saying a specific true thing. Each sentence should have a fact in it
that could only be about this product. Where it does not, it is texture.

Also recognize the opposite failure: copy sanded so hard to avoid tells
that it loses all rhythm and reads like a spec. Varied sentence length,
the occasional aside, one dry line, are what human copy has. The goal is
to sound like a specific person, not like nobody.

## 7. Reviewing specific asset types

**Landing page.** Lenses 1, 2, 6 carry most weight. Check the section order
against the reader's questions; check the hero at 360px; check that every
objection in the map has an answer on the page; check proof hierarchy
(strongest proof used, weakest removed). Produce the handoff note for
`design` if the copy changes section lengths.

**Pricing page.** Lens 1 and 8. Who each plan is for; the price with its
basis; deltas not repeats; toggle copy honest; "free" claims accurate;
competitor price claims dated.

**README.** Treat as a landing page (`developer-marketing.md` section 3).
Check: one-liner in the first two lines; install visible; quickstart under
five minutes and tested; limitations present; badges disciplined; matches
the website.

**Launch post / Show HN.** Lens 5 (register) above all. HN register is
plain and understated; marketing vocabulary is the fatal finding. Check for
the story, the mechanism, the honest limits, the direct link.

**Email.** Lens 6 and 1. First line is the reason; one link; under 150
words for lifecycle; from a person; no "hope this finds you well";
unsubscribe present; subject says what is inside.

**Blog / SEO post.** Lens 2, 3, 4 plus the brief: does it answer the query
in the first 100 words; does it have experience only a practitioner has;
is there an opinion; would it be worth reading without search engines.

**Case study.** Lens 3. Named person and company with permission; numbers
with method; friction included; the customer's words, not the vendor's.

**Social post.** Lens 5 and 6. Platform register (see
`social-and-community.md`); first line stands alone; one ask; media
present.

**Comparison page.** Lens 3 and 8. Every competitor fact verifiable and
dated; no disparagement; the "when they're better" section exists.

## 8. Reviewing your own draft

The agent's first draft has the AI tells by default; reviewing it is not
optional. Additional steps for self-review:

- Wait a beat between writing and reviewing; re-read as a stranger, not as
  the author who knows what was meant.
- Run the paste test on every headline and value prop. Be harsh.
- Count: em dashes, triads, "not X but Y", punchy endings, banned words.
  Numbers do not lie to you the way impressions do.
- Check every number and name against the truth sheet. If you cannot find
  the source, you invented it; remove it.
- Compare register to the existing material one more time.
- Cut 20% of the words. There is always 20%.
- Ask: does sentence one contain a noun that could only be about this
  product? If not, start over on sentence one.

## 9. Failure modes of reviewers

- **Rewriting into your own voice.** The review's job is a sharper version
  of theirs, not a version of yours.
- **Line edits on a structural problem.** Polishing sentences in a section
  that should not exist.
- **Edits without rationale.** The author accepts them and learns nothing;
  the next draft has the same problems.
- **Generic feedback.** "Make it punchier", "needs more energy". Name the
  sentence and the fix.
- **Missing the invented claim.** The one finding that is not optional.
- **Sanding off the personality** along with the problems. Dry asides and
  terse fragments can be the voice; check before "fixing" them.
- **Reviewing without knowing the reader or the job.** Produces copy that
  sounds fine and converts nobody.
- **Scoring without reasons.** A 2 means nothing without the sentence that
  explains it.
- **Delivering only the clean version.** The author cannot see what
  changed.
- **Praising nothing.** They do not learn what to keep.
