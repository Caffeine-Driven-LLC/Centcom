# Landing page conversion

The conversion logic of a landing or pricing page: what each section has to
accomplish in the reader's head, in what order, with what proof. The
`design` skill owns how it looks (`design/references/landing-pages.md`:
hero patterns, section rhythm, pricing table anatomy, social proof layout,
performance). This file owns what it says, why the sections are ordered as
they are, how objections are mapped, pricing packaging and copy, forms and
friction, and what A/B testing can and cannot do for a small site.

## Contents

1. What a landing page is for
2. The reader's state and the order of sections
3. Section-by-section conversion logic
4. Objection mapping
5. Proof hierarchy
6. The above-the-fold test
7. Long versus short pages
8. Pricing page: packaging logic
9. Pricing page: copy
10. Forms and friction
11. Trust signals
12. A/B testing realism
13. The handoff to design

## 1. What a landing page is for

One page, one reader, one action. A landing page converts a visitor in a
known state (came from a Show HN post; searched "Prisma alternative";
clicked a Twitter thread) into one next step (install, sign up, start a
trial, book a call, join a waitlist). Everything on the page either moves
the reader toward that action or removes a reason not to take it. Anything
else is a distraction, including a second CTA of equal weight, a blog feed,
and a "features" list of things the reader does not care about.

A homepage is a landing page with several entry states; it has to serve
the curious stranger first and give the others a visible path. Pricing,
docs, comparison and use-case pages are landing pages for narrower states.
Write each for its state.

## 2. The reader's state and the order of sections

Readers arrive skeptical, scanning, and with a question. The sequence of
questions is nearly universal, and the page should answer them in order:

1. What is this? (two seconds)
2. Is it for someone like me? (five seconds)
3. Why would I use it instead of what I have? (fifteen seconds)
4. Does it actually work? Who says? (thirty seconds)
5. What does it cost, and what is the catch?
6. What happens if I click?

A page that puts testimonials before explaining what the product is answers
question 4 before question 1. A page that opens with a pricing table answers
5 before 3. The order of sections is the order of questions.

## 3. Section-by-section conversion logic

Each section below has a job, the content it needs, the length, and the
failure mode. Lengths are for copy; design decides the visual treatment.

### Nav

Job: orientation and a persistent CTA. Content: logo, 3-5 links the
stranger needs (Docs, Pricing, Blog or Changelog, GitHub for OSS), one
primary CTA matching the hero's. Failure: eight links, two CTAs, "Solutions"
dropdown on a single-product site.

### Hero

Job: answer questions 1 and 2, and start on 3. Content: headline (under 12
words, names category or job plus differentiator), subhead (one or two
sentences: mechanism, audience, or the strongest proof), one primary CTA
with a click trigger under it, and a visual that proves the product exists
(real screenshot, terminal, demo). Optional: a single line of proof ("2,400
stars", "Used by 14 teams").

Copy length: headline 40-70 characters; subhead 90-160 characters; CTA
under 25 characters; click trigger under 45.

Failure modes: a headline about the company's mission; a subhead that
repeats the headline longer; two equal buttons; a stock image; a hero that
needs the second section to be understood.

### Credibility strip

Job: a fast answer to "is this real". Content: logos with permission, or a
single number with a date, or press mentions, or a GitHub star badge. For
pre-launch: skip it. An empty or weak credibility strip (three logos
nobody knows, or "as featured in" a newsletter) hurts more than none.

### Problem or context (optional)

Job: make the reader feel the pain they are tolerating, in their words.
Needed when the alternative is "do nothing" or a general tool; skip it
when the reader already knows the problem (a "Prisma alternative" searcher
does not need the problem explained). Content: 2-4 sentences, specific,
with the reader's own phrasing from issues and forums. Failure: a generic
"In today's world, teams struggle with..." paragraph.

### Core value sections (2-4)

Job: each delivers one value proposition with its mechanism and proof.
Content per section: a heading that states the change (not the feature
name), 2-3 sentences of mechanism, a proof element (screenshot of the
actual thing, code, number, quote), optionally a link to docs. Order by
the target customer's priority.

Copy length per section: heading under 60 characters; body 40-80 words.

Failure: a heading that is the feature name ("Real-time sync"); a body
that lists sub-features; identical structure in every section (design's
rhythm problem, but the copy causes it when every section has exactly a
heading, two sentences and three bullets).

### How it works (optional, developer products)

Job: answer "what would I actually do" for a technical reader. Content:
three to five steps, each with a command or a line of code, honest about
what is required. This is often the highest-converting section for
developer tools because it replaces trust with evidence. Failure: steps
that hide the hard part ("3. Configure your environment").

### Deep proof

Job: answer question 4 properly. Content: one strong testimonial with
name, role, company and photo or logo, or one case study teaser (who,
what changed, a number), or a benchmark with methodology, or a public
metrics page. One strong proof beats six weak ones. Failure: invented
quotes, five-star graphics without a source, "Sarah K." with no company.

### Objections section

Job: remove the remaining reasons not to act. Content: the 3-6 objections
from section 4 below, each answered in two sentences, not hidden in an FAQ
accordion unless the page is long. "Who is this not for" belongs here and
is often the most persuasive block on the page.

### Secondary features (optional)

Job: reassure the reader that table-stakes exist without spending hero
space on them. Content: a dense list of one-liners ("Everything else: SSO,
audit log, API, CSV export, 2FA"). Failure: giving each of these its own
section.

### Pricing (if self-serve)

Job: answer 5 and prevent the bounce to "how much does it cost". Content:
see sections 8 and 9. If pricing is not public, say so plainly and say why
("Pricing depends on volume; most teams pay between $X and $Y a month").

### FAQ (optional)

Job: catch long-tail objections and rank for question queries. Content:
real questions from support and sales, answered directly. Failure: FAQs
that are really features in question form ("Does it have real-time sync?").

### Final CTA

Job: restate the one-liner and ask once more. Content: a short line that
restates the value for the reader who scrolled everything, the same CTA as
the hero, the click trigger. Failure: a different CTA from the hero; a
newsletter signup competing with the action.

### Footer

Job: legal, navigation, trust. Content: links, company legal name and
address if B2B (trust signal in EU markets), privacy and terms, status
page, security page. Newsletter field if email is part of the strategy
(see `email.md`).

## 4. Objection mapping

Before writing, list what will stop the target reader. Sources: sales
conversations, support tickets, the "but" in user interviews, competitor
comparison threads, HN comments on similar products, your own skepticism.
Typical sets:

**Developer tool**
- Is this another thing I have to maintain? (answer: how it is installed,
  updated, removed)
- Will it lock me in? (answer: output format, exit path, license)
- What happens at scale / with my weird schema? (answer: limits, tested
  sizes, known gaps)
- Who maintains this and will they still be here next year? (answer:
  team, funding or sustainability model, release cadence)
- Is it secure? Does it phone home? (answer: telemetry policy, data flow)
- How is this different from X? (answer: comparison, including where X
  wins)

**B2B SaaS**
- Does it integrate with what we use? (named integrations)
- How long to set up? (honest number, what is needed)
- What does it cost at our size? (calculator or examples)
- What about our data? (hosting region, export, deletion, certifications)
- Can I get out? (export, cancellation terms)
- Who else like us uses it? (segment-matched proof)

**Consumer app**
- Is it free? What is the catch? (free tier scope, plainly)
- Is my data private? (specific mechanism)
- Does it work on my device / offline?
- Is it going to spam me?
- What if I want to leave? (export)

Map each objection to the section that answers it and the sentence that
does so. An objection answered nowhere on the page is a leak. An objection
answered only in an FAQ accordion is a leak for the 80% who do not open
accordions.

## 5. Proof hierarchy

Not all proof is equal. From strongest to weakest for a skeptical reader:

1. **The product itself, usable now.** A live demo, a sandbox, a `curl`
   that returns something, a playground. Nothing beats trying it.
2. **Reproducible evidence.** A benchmark with the script in the repo; a
   public status page; a public metrics dashboard; an open issue tracker.
3. **Named, specific, permissioned customer evidence.** A quote with name,
   role, company, photo, and ideally a number ("cut our invoice disputes
   from ~8 to 1 a month"). A case study. A logo with a linked story.
4. **Public counts, dated.** GitHub stars, npm downloads/week, App Store
   rating with count, number of paying teams.
5. **Third-party validation.** Press from an outlet the reader respects, an
   award they have heard of, a certification (SOC 2 with type).
6. **Founder credibility.** Where they worked, what they built before, why
   they are the ones to build this. Strong pre-launch, weaker later.
7. **Unnamed or generic evidence.** "A fintech company", "teams love it".
   Nearly worthless; often negative.

Use the strongest proof you have in the hero and deep proof sections. Do
not pad with level 7 to fill a layout; tell design the section is smaller
or absent.

## 6. The above-the-fold test

Show only the first viewport (no scrolling) to someone in the target group
for five seconds, then ask:

- What does this product do?
- Who is it for?
- What would you click?

Three out of three means the hero works. Common failures and fixes:

| Failure | Fix |
|---|---|
| "Something to do with data?" | Headline names the category noun |
| "For enterprises?" when it is for individuals | Subhead names the person |
| "I'd click... the logo?" | One CTA, visually dominant (design), named action (marketing) |
| "Looks like every SaaS page" | Specific noun or number in headline; real screenshot |
| "I'd need to read more" | Headline is a mission statement; replace with the one-liner |

Run it mentally on your own draft at 360px width too: the headline wraps to
four lines, the subhead is below the fold, and the CTA is off-screen. The
mobile hero is headline, one line of subhead, one button.

## 7. Long versus short pages

Short pages (hero, three sections, CTA) convert better when: the reader
already understands the category, the action is low-commitment (install,
free signup), the audience is technical and impatient. Long pages convert
better when: the action is high-commitment (paid trial, demo, purchase),
the category is unfamiliar, the alternative is "do nothing", or the price is
high. Long pages for developer tools usually lose; a developer scrolling
past the fourth marketing section is looking for the docs link.

A useful compromise: a short page with a dense "How it works" and a deep
proof section, plus separate pages for comparison, pricing and use cases
that each go long for the reader who needs them.

Length is set by the number of objections that need answering before the
action, not by a target word count. Count the objections, write the
answers, and the length is what it is.

## 8. Pricing page: packaging logic

Packaging is deciding what goes in which plan and why. Copy renders it. Get
the logic right first.

**Good-better-best (three tiers).** The default for self-serve SaaS because
it gives a reference point in each direction. The middle tier is where most
revenue should land; design it for the target customer and mark it
recommended. Low tier: enough to be genuinely useful for the smallest real
customer, missing the one thing the target customer needs. High tier:
everything, plus the things that signal "serious" (SSO, audit log, priority
support, SLA), priced to make the middle look reasonable.

**Anchoring.** The visible high price makes the middle feel moderate. An
"Enterprise: contact us" column anchors upward without stating a number.
Showing the annual price per month ("$10/mo billed annually") anchors lower;
show the monthly equivalent and the annual total both, or you will get
complaints.

**Axis of value.** Pick one thing that scales with the value the customer
gets and price on it: seats, usage (events, invoices, minutes), projects,
revenue. The axis should grow when the customer grows and be understandable
in advance. Seats are predictable but penalize collaboration; usage aligns
value but makes bills unpredictable; a hybrid (base plus usage) is common
for a reason. Never price on an axis the customer cannot forecast.

**Free tier logic.** A free tier is an acquisition channel, not charity.
Include one when: the product gets better with network effects or
word-of-mouth; the marginal cost of a free user is near zero; the free
tier naturally runs out at the point the user is getting serious value;
the sales motion is self-serve. Skip it when: each user costs real
infrastructure; the buyer is a team with budget who would pay anyway; a
free trial converts better (common in B2B). The free tier's limit should
be a usage ceiling the target customer crosses, not a feature cripple
that makes the product look bad.

**Trial versus freemium.** A time-limited trial (14 days, 30 days) forces a
decision and suits products where value is clear within days. Freemium
suits products that take time to become essential. "Free for solo
developers, paid for teams" is the developer-tool pattern that works
because the solo user is the champion who brings the team.

**Annual discount.** 15-20% (two months free) is the norm. The toggle
copy should state the saving in money or months, not just "save 20%".

**Open source pricing.** Free self-hosted, paid hosted (convenience) or paid
features for teams (SSO, RBAC, audit). Say plainly what is open and under
which license; the "open core" question is the first one a developer asks.

## 9. Pricing page: copy

The pricing page has the highest-intent reader on the site and the lowest
tolerance for ambiguity. Rules:

**Each plan says who it is for in one line.** "For solo developers", "For
teams of 2-10 shipping weekly", "For companies that need SSO and a
contract". This line does more conversion work than the feature list; the
reader self-selects.

**Price, period, and basis in one glance.** "$12 per seat / month" or "$49 /
month, up to 1,000 invoices". Taxes, minimums, and overage in 12-13px
below, not in a tooltip.

**Feature lists are deltas.** The second column says "Everything in Starter,
plus:" and lists only the additions. Repeating the full list makes it hard
to see what the extra money buys.

**Name the one thing.** For the recommended tier, the first listed addition
should be the thing the target customer came for. If the middle tier's
first bullet is "priority support", the packaging is wrong.

**Toggle copy.** "Monthly" / "Annual (2 months free)". Show the annual as
"$10/mo, $120 billed yearly". Do not show only the per-month annual price
with the billing term in grey; it is a dark pattern and generates refunds.

**Free tier copy.** State the ceiling as a plain fact: "Free up to 3
projects and 1,000 events a month. No card." When the ceiling is hit, the
upgrade prompt in-product (design's domain) should repeat the same words.

**Enterprise column.** No price is fine if you say what changes: "Custom
pricing for 50+ seats. Adds SSO, audit log, a contract, and a human to
call." "Contact sales" as the CTA; a form, not a chatbot.

**FAQ under the table.** The real questions: can I change plans, what
happens if I go over, do you offer discounts for nonprofits/students/OSS,
how do I cancel, what counts as a seat/event. Answer each in two sentences.

**Comparison claims on pricing pages** ("half the price of X") need the
competitor's public pricing as of a date; see `claims-and-compliance.md`.

Before/after:

Before:
```
Starter  $9/mo   For individuals
Pro      $29/mo  For professionals   [Most popular]
Team     $99/mo  For teams
```
After:
```
Solo     $9/mo        One person, up to 3 clients. Invoices and reminders.
Studio   $12/seat/mo  Teams of 2-10 billing hourly. Adds client approval,
                      Xero/QuickBooks sync, and the payment ledger.
                      [Most firms pick this]
Firm     $24/seat/mo  10+ seats, or you need SSO, roles and an invoice.
```
Why: the after says who each is for in a way the reader can match
themselves against, lists deltas, and names the one thing (client approval,
sync) in the recommended tier.

## 10. Forms and friction

Every field costs conversion. Rules of thumb from published form studies
(the numbers vary by study and audience; treat them as direction, not law):
each additional field costs on the order of a few percentage points of
completion; a phone number field costs more than any other; a "company
size" dropdown signals a sales call is coming.

**Ask for the minimum to deliver the promise.** A waitlist needs an email.
A free tier needs an email and a password, or just OAuth. A trial for a
B2B product can ask for a work email and nothing else; enrich the rest from
the domain later. A demo request can ask for email and "what are you
hoping to see", which is both friction-reducing and useful.

**Copy on forms.** Label every field (not placeholder-only; that is a
design and accessibility point too). The button names the outcome: "Create
my workspace", "Send the guide", "Start the 14-day trial". The line under
the button kills the top objection: "No card. Cancel anytime. We won't
email you except about your account."

**Progressive profiling.** Ask one more thing at each natural moment (after
first value, not before) rather than everything upfront.

**Social and OAuth login** reduce friction for consumer and developer
products; "Sign in with GitHub" on a dev tool is almost mandatory. For B2B,
Google Workspace or Microsoft login plus a magic link covers most.

**Confirmation copy.** After submit, say exactly what happens next and when:
"Check your inbox for a link from hello@example.com. It usually arrives in
under a minute." A vague "Thanks!" generates support tickets.

**Multi-step forms** convert better than one long form when there are more
than five fields: the first step (just email) captures the lead even if they
abandon step two. Say how many steps there are.

## 11. Trust signals

Signals that reduce perceived risk, in rough order of effect for a B2B or
developer audience:

- A real company name, address and legal entity in the footer (EU buyers
  look for it)
- A security page that says what you actually do (encryption, hosting
  region, access controls, incident process) in plain language, with
  certifications where real
- A public status page with history
- A public changelog with recent entries (shows the product is alive)
- Open issue tracker or public roadmap
- Named founders with real bios and links
- Transparent pricing
- Clear data export and deletion path
- Terms and privacy that a human can read, with a last-updated date
- Payment through a recognized processor (Stripe, Paddle) with its branding
  at checkout
- Response time commitment for support, with the actual channel

Signals that have little or negative effect: generic "100% secure" badges,
padlock icons outside the checkout, "Trusted by 10,000+ companies" with no
names, logo walls of companies that are not customers (a conference you
spoke at is not a customer), stock photos of people in headsets.

## 12. A/B testing realism

Most small sites cannot run meaningful A/B tests, and pretending otherwise
wastes months. The math (full treatment in `analytics-and-growth.md`): to
detect a change from 3% to 3.6% conversion (a 20% relative lift, which is
large) with 80% power at 95% confidence, each variant needs roughly 8,000
visitors. At 500 visitors a week, that test runs for eight months, during
which the product, the traffic mix and the season all change.

What to do instead at low traffic:
- Make the big changes (positioning, hero, offer) sequentially and compare
  before/after conversion over matched periods, knowing it is directional.
- Test things with high expected effect only: the headline's positioning,
  the CTA action, the presence of pricing, the free tier offer. Button
  colour and the word "Get" versus "Start" are undetectable at your traffic.
- Use qualitative methods: five-second tests, session recordings on
  consenting users, the "what almost stopped you" question in onboarding.
- Test on channels with more volume than your site: two versions of a
  Twitter post, two subject lines on a 3,000-person list.

What to do at real traffic (10k+ weekly visitors to the page):
- One test at a time on a given page; pre-register the metric and the
  minimum detectable effect; run to the calculated sample size or a fixed
  duration covering at least two full weekly cycles; do not peek and stop
  early on a good day.
- Primary metric is the downstream action (signup, activation), not clicks
  on the button; a headline that raises clicks and lowers activations
  attracted the wrong people.

Honesty about results: a "winner" at 55% confidence is a coin flip. Report
the interval, not the point estimate.

## 13. The handoff to design

Deliver the page as a content outline that `design` can lay out using
`design/references/landing-pages.md`. Format:

```
PAGE: Homepage                 READER STATE: stranger from HN / search
PRIMARY ACTION: Install (npm)  SECONDARY: Read docs (text link)

1. Nav
   Links: Docs, Pricing, Changelog, GitHub       CTA: "Install" -> #quickstart

2. Hero (load-bearing)
   H1 (52 chars): TypeScript types from your live Postgres schema
   Sub (118 chars): Keep your SQL. Lose the drift. One binary, reads the
                    schema, writes types.ts, runs in CI in under a second.
   CTA: "Install in 30 seconds"  Trigger: "MIT. No account."
   Visual: terminal recording of `pgtypes gen` (6s loop), provided
   Proof line: GitHub stars badge (live)

3. How it works (load-bearing, developer page)
   3 steps, each a one-line command + one sentence; copy attached

4. Value: "Your types can't drift" (load-bearing)
   H2 (28 chars) + 62 words + screenshot of a caught rename in CI

5. Value: "Postgres types, done right" (load-bearing)
   H2 + 55 words + table of type coverage (12 rows), provided

6. Value: "No ORM, no lock-in" (optional if page runs long)
   H2 + 48 words + 8-line code sample

7. Deep proof
   One quote: name, role, company, photo (approved, attached); 41 words
   OR, if quote not approved by ship: bench results block instead

8. Who it's not for
   62 words, plain text, no visual

9. Final CTA
   Line (40 chars) + same CTA + trigger

10. Footer
    Standard; include "Security" and "Changelog"

MEASURE: event `cta_install_click` on both CTAs with `position`
property; `quickstart_viewed` on #quickstart scroll into view.
```

Mark which sections are load-bearing so design knows what can be cut for
rhythm or length, and give character counts for anything in a constrained
layout. Attach the copy in a separate block in order. Tell design the proof
elements you actually have, so they do not design a logo wall for logos
that do not exist.
