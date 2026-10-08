# Claims and compliance

The legal and ethical floor for marketing a software product: substantiating
claims, testimonial and review rules in the FTC's style (and their EU/UK
counterparts), comparative claims about competitors, "free" and pricing
claims, email consent under GDPR/PECR, CAN-SPAM and CASL, how cookie consent
interacts with analytics and marketing, dark patterns to refuse, and
accessibility of marketing content. This is practitioner guidance, not legal
advice; where real exposure exists (regulated industries, large claims,
naming a competitor in a way they might contest), tell the user to have a
lawyer look.

## Contents

1. Why this matters more for small teams
2. Substantiation: every claim has a basis
3. Testimonials, reviews and endorsements
4. Comparative claims
5. "Free", pricing and offer claims
6. Email consent: GDPR/PECR, CAN-SPAM, CASL
7. Cookie consent and analytics
8. Dark patterns to refuse
9. Accessibility of marketing content
10. Regulated and sensitive categories
11. Trademarks, logos and names
12. The pre-publish scan
13. Failure modes

## 1. Why this matters more for small teams

A large company has lawyers to argue a borderline claim. A small team has a
reputation and a community, and the community reads everything. The
discovery of an invented testimonial, a fake "limited time" offer, or a
pre-ticked consent box produces a thread that outlives the product. The
regulatory risk is real too (the US FTC fined companies for fake reviews
under its 2024 rule; EU regulators fine for consent violations; CASL
penalties are steep), but for most small teams the trust cost arrives
first.

The practical standard: do not say anything about the product, its users,
its price or its competitors that you could not back up to a skeptical
customer who asked "how do you know?" If you cannot answer, do not say it.

## 2. Substantiation: every claim has a basis

A claim is any statement a reasonable reader would take as a factual
assertion about the product's performance, results, popularity or
comparison to others. "Fast" is puffery (opinion nobody is expected to
verify); "under 50ms" is a claim; "the fastest" is a comparative claim;
"saves teams 10 hours a week" is a results claim. Regulators in the US, UK
and EU all require a reasonable basis for objective claims at the time they
are made, and the basis for a quantified or health/financial claim must be
competent and reliable evidence.

For each type of claim, what substantiates it:

| Claim type | Example | Basis required | If you lack it |
|---|---|---|---|
| Performance number | "Generates in 0.8s on a 200-table schema" | A reproducible benchmark with method, environment and date; ideally the script in the repo | State the mechanism without the number, or measure it |
| Popularity count | "2,400 GitHub stars", "14 teams in production" | The actual count, dated; a definition of "team in production" you can defend | Say what you can count; never round up or use "thousands" for 2,400 |
| Results | "Customers get paid 11 days sooner" | A cohort analysis across real customers with the method stated; or a clearly labelled single case | Describe the mechanism; use the single case as a case study, attributed, not as a general claim |
| Typical results from testimonials | A customer saying "cut disputes by 90%" | Either the result is typical (you have data) or you disclose what the typical result is | Add "results vary" is not enough in the US; disclose the generally expected result or present it as one customer's experience clearly |
| Security / compliance | "SOC 2 compliant", "GDPR compliant", "bank-grade encryption" | The actual certification with type and date; "GDPR compliant" is not a certification and should be rephrased as what you actually do | "SOC 2 Type I, report on request"; "AES-256 at rest, TLS 1.2+ in transit" |
| Feature existence | "Works with MySQL" | It works, today, in the shipped version | "Planned" or "beta", clearly labelled; never present roadmap as product |
| "No X" / "Zero X" | "Zero config", "No code changes" | Literally true from install to output | Rephrase to the true statement: "one flag" |
| Uptime / reliability | "99.99% uptime" | Measured over a stated period with a public status page | State the period or do not state the number |

Keep a **claims file** in the repo (`marketing/claims.md`): each claim in
use, its basis, its source, the date verified, and where it appears. When a
basis changes (a benchmark re-run, a customer churns), the file tells you
where to update. This is what a regulator asks for and what a careful
engineer wants anyway.

Rules: numbers are dated; comparatives have comparison data; results claims
have cohort data or are attributed single cases; roadmap is labelled; no
"up to" or asterisks doing the work of honesty.

## 3. Testimonials, reviews and endorsements

The rules below follow the US FTC's Endorsement Guides and its 2024 rule on
fake reviews and testimonials; the UK CMA and EU Unfair Commercial Practices
Directive (as amended by the Omnibus Directive) are broadly aligned.

**Testimonials must be real.** A testimonial is a statement by an actual
user reflecting their honest opinion and actual experience. Inventing one,
composing one and attributing it to a real or fictional person, or editing
one to change its meaning is prohibited. "Sarah K., CTO" who does not exist
is a violation, not a placeholder.

**Permission.** Get written permission (email suffices) to use the person's
name, role, company and likeness, and the specific quote. Confirm the final
text with them. Keep the record.

**Editing.** Fix typos and trim for length; do not change meaning, add
claims, or remove caveats that change the sense. Mark trims with an
ellipsis if the omission is material. Confirm edits with the author.

**Typicality.** If a testimonial claims a specific result ("cut our disputes
by 90%"), the FTC position is that readers take it as what they can
expect. Either you have evidence that it is typical, or you clearly
disclose what the generally expected result is. "Results may vary" alone
is treated as inadequate. Practical approach for a small team: present
results as the specific customer's experience with context ("Flowstep, a
4-person studio, went from ~8 disputes a month to 1"), in a case study,
and avoid implying generality.

**Material connections must be disclosed.** If the endorser was paid, given
free product, is an investor, employee, family member, or has any
relationship a reader would want to know about, disclose it clearly and
near the testimonial: "Mira is an advisor to pgtypes." Free access to a
paid tier in exchange for a review is a material connection.

**Incentivized reviews.** You may ask customers for reviews. You may not
condition an incentive on the review being positive, and in the US you may
not offer incentives for reviews expressing a particular sentiment. If you
offer an incentive for any review, disclose that incentivized reviews were
solicited where the reviews appear, and the platform's rules (G2, Capterra,
app stores) apply too, and are often stricter.

**Review gating** (asking only happy customers to review publicly while
routing unhappy ones to private feedback) is prohibited under the FTC's
2024 rule and under platform rules. Ask everyone, or no one.

**Suppressing or curating reviews.** On your own site, you may not display
only positive reviews while implying they are all the reviews. Either show
all (with moderation only for abuse), or make clear these are selected
testimonials, not a review aggregate.

**Employee and insider reviews.** Employees, contractors and their families
posting reviews without disclosure is a violation. Tell the team.

**Star ratings and "rated 4.9/5".** Only with a real aggregate from a named
source, with the count and date. Five-star graphics without a source are
treated as a rating claim.

**Logos as endorsements.** A logo wall implies those companies are
customers who permit the use. Each logo needs: they are actually a customer
(a free user of an open source tool is a stretch; an employee who used it
once is not), and permission to display the logo, which many companies'
brand or procurement policies restrict. "Used by engineers at..." is a
weaker claim with a lower bar but still needs to be true and permissioned.

**Social proof from public sources.** Quoting a public tweet or GitHub
comment is generally permissible for the words themselves, but using it on
a sales page as an endorsement still benefits from asking, and attribution
must be accurate. Do not screenshot a tweet and crop out context.

## 4. Comparative claims

Naming a competitor and comparing is legal in the US and EU/UK when the
comparison is truthful, not misleading, compares like with like, and does
not disparage or take unfair advantage of the competitor's trademark. The
EU's Comparative Advertising rules (in the Misleading and Comparative
Advertising Directive) are more specific than US law: comparisons must be
objective, of material, relevant, verifiable and representative features,
and must not create confusion or denigrate.

Practical rules:

- **Facts, dated, sourced.** "As of October 2026, Prisma's enum mapping
  produces TypeScript enums (source: their docs, linked)". Re-verify
  quarterly; put the last-checked date on the page.
- **Like with like.** Compare the same tier, the same workload, the same
  version. A benchmark of your optimized path against their default is
  misleading.
- **Verifiable.** A reader (or the competitor) can reproduce it. Publish
  the method.
- **No denigration.** Describe what they do; do not characterize it as
  broken, terrible, legacy, or a scam. "X does not support Y" is fine if
  true; "X's Y support is garbage" is not.
- **Representative.** Do not cherry-pick the one scenario where you win and
  present it as general.
- **Superlatives need the comparison set.** "Fastest" means faster than
  every alternative a reader would consider; you need benchmarks against
  each, or you cannot say it. "Faster than Prisma on schema introspection
  (bench linked)" is defensible; "the fastest" rarely is.
- **Their name, not their logo.** Nominative use of a competitor's name in
  text to identify them is generally permitted. Using their logo is a
  trademark question; most brand guidelines restrict it. Default: name
  only.
- **Expect them to read it.** Write every comparison so that the
  competitor's engineers would say "fair". If you would be embarrassed to
  send it to them, rewrite it.

When the user wants a claim you cannot substantiate ("say we're the fastest"),
explain the exposure and offer the defensible version.

## 5. "Free", pricing and offer claims

**"Free."** In the US (FTC Guide Concerning Use of the Word "Free") and
EU/UK, "free" means free: no cost, no obligation beyond what is clearly
stated. "Free trial" that requires a card and auto-converts must say so
plainly at the point of signup, with the price and the date it converts.
"Free" that is actually "free with a paid plan" is misleading. "Free tier"
must describe its limits where the word appears, not three clicks away.

**Price display.** Show the total a customer will pay, including recurring
terms. "$10/mo" that is actually "$120 billed annually" must show both.
Taxes: say whether they are included; in the EU, consumer prices must be
shown inclusive of VAT. Per-seat minimums, overage charges and setup fees
appear with the price, not in a tooltip.

**Strikethrough "was" prices.** Only if the product was actually offered at
that price for a reasonable period recently. Fictitious former pricing is
specifically prohibited in most jurisdictions.

**"Limited time" and scarcity.** Only if true. A countdown timer that resets
per visitor, "only 3 spots left" for a SaaS, or a "launch discount" that
never ends are deceptive and, in the EU/UK, specifically listed unfair
practices.

**Auto-renewal.** Disclose clearly before purchase; obtain affirmative
consent; send reminders for annual plans (required in several US states and
under UK rules coming into force); make cancellation as easy as signup (the
FTC's click-to-cancel rule and California's ARL). Marketing copy that says
"cancel anytime" must be true in one or two clicks.

**Price changes.** Notify existing customers in advance (30 days is the
common minimum in terms of service and some laws); honour the price for the
current term. Marketing that announces a new price should say what happens
to existing customers.

**Discounts and coupons.** State the conditions (new customers only, first
year, specific plan) where the discount is advertised.

## 6. Email consent: GDPR/PECR, CAN-SPAM, CASL

Which law applies depends on where the recipient is, not where you are.
Most small teams have recipients in all three regimes and should design to
the strictest.

**EU and UK (GDPR plus the ePrivacy rules, PECR in the UK).**
- Marketing email to individuals requires prior opt-in consent that is
  freely given, specific, informed and unambiguous: an unticked box or an
  explicit action, with a clear statement of what they are signing up for.
- Consent cannot be bundled with terms of service or made a condition of
  using the product.
- Exception: the "soft opt-in" (UK and some EU states): existing customers
  who gave their email in the course of a purchase or negotiation may be
  emailed about similar products if they were given a chance to refuse at
  collection and in every message. This does not cover people who only
  signed up for a free tier in all jurisdictions; check.
- B2B: some EU states treat corporate emails more permissively; the UK does
  for corporate subscribers but not sole traders. Do not rely on this
  without checking the specific country.
- Every message: identity of the sender, a working unsubscribe, and
  honouring it promptly.
- Records: when, how and to what each person consented. Your email tool
  should store this; verify it does.
- Transactional and service emails (receipts, security notices, necessary
  account emails) do not need marketing consent and must not carry
  marketing to people who have not consented.

**United States (CAN-SPAM).** Opt-out, not opt-in: you may email without
prior consent, but every commercial message must have accurate headers and
From, a non-deceptive subject, identification as an ad where applicable, a
valid physical postal address, a clear unsubscribe mechanism that works
for at least 30 days and is honoured within 10 business days, and you may
not sell or transfer the addresses of people who opted out. In practice,
Gmail and Yahoo's bulk sender requirements (one-click unsubscribe, DMARC,
complaint rate under 0.3%) make opt-in the only sustainable approach in the
US too.

**Canada (CASL).** Requires express consent (clear opt-in, with records) or
implied consent (existing business relationship within two years, an
inquiry within six months, a conspicuously published address with no
opt-out statement for relevant messages). Every message identifies the
sender with contact information and has an unsubscribe honoured within 10
days. Penalties are among the highest; Canadian recipients should be
opt-in only.

**Operational design that satisfies all three** (detail in `email.md`):
- Separate, unticked checkbox for marketing at signup, with a one-line
  description of what and how often
- Double opt-in for newsletters
- Consent record stored per contact
- One-click unsubscribe in every marketing message, plus List-Unsubscribe
  headers
- Physical address in the footer
- Marketing and transactional streams separated
- Suppression list honoured across all tools

**Cold outreach** (emailing people who never heard of you): legal under
CAN-SPAM with the required elements; generally unlawful to individuals in
the EU/UK without consent (B2B corporate addresses are a grey area that
varies by state); unlawful in Canada without implied consent. For a small
team, cold email to EU individuals is not worth the exposure; personal,
one-to-one outreach to a journalist or newsletter writer in a professional
capacity is a different matter from bulk sends, but keep it genuinely
individual.

## 7. Cookie consent and analytics

In the EU/UK, setting non-essential cookies or similar identifiers
(including localStorage used for tracking, fingerprinting, and most
third-party analytics and advertising pixels) requires prior consent. Many
US states' privacy laws (California's CCPA/CPRA and others) require opt-out
of "sale/sharing" for targeted advertising and honour Global Privacy
Control signals. Enforcement in the EU has focused on consent banners that
make refusing harder than accepting.

How this interacts with marketing:

- **Cookieless, privacy-focused site analytics** (Plausible, Fathom, Umami,
  Simple Analytics, and similar) that do not set identifiers and do not
  track across sites are generally held not to require consent in most EU
  states (the French CNIL has specific exemption criteria; a few DPAs are
  stricter). This is the easy path for a marketing site: no banner, less
  friction, and a signal developers appreciate.
- **Google Analytics, ad pixels, session recording, and most product
  analytics on the marketing site** require consent in the EU/UK. Load them
  only after consent; a banner that loads them before the click is a
  violation.
- **Product analytics inside the logged-in app** tied to the account is
  typically justified by contract or legitimate interest, disclosed in the
  privacy policy, with an opt-out where feasible; still avoid third-party
  advertising identifiers there.
- **If a banner is required**: "Accept" and "Reject" with equal prominence
  (design's rule in `design/references/landing-pages.md` matches the
  regulators'); no pre-ticked boxes; no cookie wall for non-essential
  purposes; granular choices available; consent recorded; easy withdrawal
  later (a footer link).
- **Email tracking** (open and click tracking pixels and redirects) is
  covered by the same rules in the EU; disclose it in the privacy notice
  and the signup copy, and prefer click tracking over open tracking.
- **UTM parameters** on your own links are not tracking in the regulated
  sense; they are fine.
- **Server-side event collection** for the facts about the system
  (signups, subscriptions) is first-party processing covered by the privacy
  policy.

The marketing-relevant decision: choose the analytics stack so the
marketing site needs no banner (cookieless), and reserve consent-requiring
tools for the app behind a proper notice. Tell the user when a requested
tool (a retargeting pixel, a heatmap) brings a banner with it.

## 8. Dark patterns to refuse

Regulators (FTC, EU under the DSA and UCPD, UK CMA) now name and penalize
these; communities name them faster. Refuse to build them and say why:

- **Confirmshaming**: "No thanks, I don't want to save money." Use a plain
  "No thanks".
- **Pre-ticked consent** for marketing, data sharing, or add-ons.
- **Roach motel**: easy to subscribe, hard to cancel (phone-only
  cancellation, retention mazes). Cancellation matches signup.
- **Fake scarcity and urgency**: resetting countdowns, invented stock
  counts, "12 people are viewing this".
- **Drip pricing**: revealing fees at the last step.
- **Hidden auto-renewal** or trial-to-paid conversion without clear notice.
- **Disguised ads**: sponsored content or affiliate links without labels.
- **Forced continuity** with unclear reminders.
- **Nagging**: repeated interruptions to consent or upgrade after refusal.
- **Obstruction**: "Reject" buried in a sub-menu while "Accept" is one
  click.
- **Misdirection**: a prominent "Accept all" and a grey text link "manage
  preferences" that is actually "reject".
- **Bait and switch**: advertising a feature or price then substituting
  another.
- **Fake reviews, fake testimonials, fake social proof** ("Joined 3 minutes
  ago" notifications that are generated).
- **Sneaking**: adding items to cart, opting into insurance or extras.
- **Trick questions**: double negatives in consent copy.
- **Friend spam**: using contact access to message contacts.
- **Growth hacks on OSS**: `npm install` output that prints marketing, CLI
  tools that open browser tabs to pricing, telemetry opt-out buried in docs.

If the user asks for one of these, explain the regulatory and trust
exposure and offer the honest alternative. The honest alternative
frequently converts as well or better over any horizon longer than a week.

## 9. Accessibility of marketing content

Marketing content is subject to the same accessibility expectations as
the product, and in several jurisdictions the same law (the EU
Accessibility Act applies to many e-commerce and service sites from 2025;
the ADA has been applied to websites in US courts; UK Equality Act). Beyond
the law, inaccessible marketing excludes buyers. The implementation is
`frontend`'s and the visual design is `design`'s; marketing's part is the
content:

- **Plain language** at a reasonable reading level (grade 7-9 for
  marketing) helps everyone, including readers with cognitive disabilities
  and non-native speakers.
- **Headings as structure**, not styling: a logical hierarchy a screen
  reader can navigate.
- **Link text that describes the destination**: "Read the quickstart", not
  "click here" or "here".
- **Alt text** for every content image, describing what it conveys; empty
  alt for decorative images. For screenshots, say what is shown and what it
  demonstrates.
- **Video**: captions (also what most social viewers use) and a transcript;
  audio description where visuals carry meaning the narration does not.
- **Do not convey meaning by colour alone** in content (a "green means
  supported" table needs a text indicator too).
- **Avoid text in images** for anything that matters; if a comparison table
  is an image for social, the page version is real HTML.
- **No flashing content**; autoplaying video muted and pausable.
- **Form labels** on every field in the marketing forms (not placeholder-
  only).
- **Reading order** in the copy matches the visual order (hand design the
  content in order).
- **PDFs** (whitepapers, one-pagers) are often the least accessible
  artifacts a company publishes; prefer HTML; if PDF, tag it.

Hand the content-side requirements to `design` and `frontend` with the copy;
they own contrast, focus, target size and ARIA.

## 10. Regulated and sensitive categories

If the product touches any of these, claims need more than this file:

- **Health, medical, mental health, fitness, nutrition**: outcome claims
  require clinical-grade evidence; "clinically proven" has a specific
  meaning; apps that diagnose or treat may be medical devices (FDA, MDR).
- **Finance, lending, investing, crypto, insurance**: performance claims,
  "guaranteed", APR disclosures, risk warnings; securities and consumer
  credit regulators have specific advertising rules.
- **Children**: COPPA in the US (under 13), GDPR's child consent rules,
  age-appropriate design codes; marketing to or collecting data from
  children is a different regime.
- **Security products**: "unhackable", "military-grade", "100% secure" are
  unsubstantiable and invite both regulators and researchers.
- **Employment, housing, credit decisions**: anti-discrimination law applies
  to targeting and to claims.
- **Alcohol, gambling, cannabis, tobacco**: platform and jurisdictional
  advertising restrictions.
- **AI claims**: the FTC has warned specifically about exaggerated AI
  capability claims and "AI washing"; EU AI Act transparency obligations
  are phasing in. Say what the model does, not that it is "intelligent".
- **Environmental claims** ("green", "carbon neutral"): green-claims rules
  in the EU/UK require substantiation and specificity.

For any of these, draft conservatively and tell the user to get the claims
reviewed by someone qualified.

## 11. Trademarks, logos and names

- **Your own name**: check that it is not already a registered mark in your
  class in your main markets before building a brand around it; a basic
  search in USPTO TESS, EUIPO and the UK IPO databases takes an hour. A
  rename after launch is expensive.
- **Competitor names in text**: nominative use to identify or compare is
  generally permitted. Use their capitalization. Do not use their name in
  your product name, domain or as a keyword in a way that implies
  affiliation.
- **Competitor logos**: default to not using them. Check their brand
  guidelines; many permit use in integration lists ("works with") under
  conditions and forbid it in comparisons.
- **Customer logos**: permission, as in section 3.
- **Third-party marks in integrations**: "Works with Slack" is typically
  fine under their partner guidelines; "Slack-certified" is not unless you
  are.
- **"Powered by" and attribution requirements**: some APIs and open source
  licenses require attribution in marketing or product; check the license
  and terms.
- **Open source project names** (Postgres, Kubernetes, Linux) are often
  trademarked by foundations with usage policies; "for Postgres" is fine,
  "PostgresPro" as a product name may not be.
- **Domain and handle squatting**: register the obvious misspellings and
  the handles on the platforms you will use before announcing.

## 12. The pre-publish scan

Before any marketing asset ships, search it for these and resolve each:

```
Comparatives:    best, fastest, only, #1, leading, most, -est words
Results:         any number followed by a result (hours saved, % faster,
                 days sooner); any "customers see / teams get"
Popularity:      trusted by, used by, thousands, millions, loved by
Proof artifacts: every testimonial (real? permitted? typicality?), every
                 logo (customer? permitted?), every star rating (source?)
Competitors:     every competitor name (facts true? dated? sourced? no
                 denigration? no logo?)
Pricing words:   free, trial, no credit card, cancel anytime, save X%,
                 was $X, limited time, only N left
Security words:  secure, compliant, encrypted, certified, SOC, ISO, GDPR,
                 HIPAA, bank-grade, military-grade
Capability:      zero config, no code, works with, supports, any/all
Roadmap:         coming soon, planned, beta, preview (labelled as such?)
Regulated:       health, medical, financial, children, AI, green
Email:           consent language, unsubscribe, address, sender identity
Forms:           pre-ticked boxes, bundled consent
Accessibility:   alt text, link text, captions, headings
```

Each flagged item ends as: substantiated (source recorded in the claims
file), rewritten to a true statement, or removed. Record the scan in the
PR or the delivery note.

## 13. Failure modes

- **"Sarah K., CTO."** The invented testimonial. The one finding that stops
  a review.
- **"Trusted by thousands" at 2,400 stars.** Rounding up popularity is a
  false claim and a trust loss when anyone checks.
- **"The fastest" with one benchmark against one competitor.** The
  comparison set is missing.
- **Results from one customer presented as typical.** Typicality
  disclosure required; present as a case study instead.
- **Pre-ticked marketing consent.** Invalid consent under GDPR, and the
  complaint rate follows.
- **Marketing in transactional emails to non-consenting users.**
- **"Free trial" that silently converts.** Disclose price, date and
  cancellation at signup.
- **Countdown timer that resets.** Listed unfair practice.
- **Competitor logos in a comparison table.** Trademark exposure with no
  upside; the name does the job.
- **"GDPR compliant" as a badge.** Not a certification; say what you do.
- **Google Analytics loaded before consent on an EU-facing site.**
- **Alt text missing on the comparison table image.** The buyer with a
  screen reader cannot compare.
- **Stale competitor pricing on a vs page.** Misleading the day they
  change it; put the date on and check quarterly.
- **No claims file.** When a basis changes, nobody knows where the claim
  lives.
