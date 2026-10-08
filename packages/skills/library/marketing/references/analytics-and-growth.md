# Analytics and growth

Measuring marketing honestly for a small software product: defining the
funnel, choosing a north-star metric and the input metrics that move it,
naming events so the data stays usable, what attribution can and cannot
tell you, cohort basics, experiment design with a sample size sanity check,
reading dashboards without fooling yourself, growth loops versus funnels,
and why pricing experiments deserve extra caution.

## Contents

1. What analytics is for at this stage
2. Define the funnel
3. North-star and input metrics
4. Event taxonomy and naming
5. Attribution honesty
6. Cohorts
7. Experiment design
8. Sample size sanity check
9. Reading dashboards without fooling yourself
10. Growth loops versus funnels
11. Pricing experiments
12. Tooling and privacy
13. Reporting
14. Failure modes

## 1. What analytics is for at this stage

For a team of two to ten, analytics has one purpose: to tell you where in
the path from stranger to paying, retained user the most people are being
lost, so you fix that next. Everything else (attribution models, dashboards
with forty tiles, LTV:CAC projections) is premature until the funnel is
defined, instrumented and read weekly.

The second purpose, once the first works, is to tell you whether a change
you made did anything. That requires more rigour than most teams apply,
and section 8 is about being honest when the answer is "we can't tell."

## 2. Define the funnel

Write down the stages a person moves through, the event that marks each,
and the current rate between each. The stages for most software products:

```
Stage          Marker event                         Typical range*
───────────── ──────────────────────────────────── ───────────────────
Visit          page_viewed (marketing site)          –
Engaged visit  scrolled 50% / viewed pricing / docs  30-60% of visits
Signup         account_created                       1-5% of visits (self-
                                                     serve SaaS); 5-15%
                                                     for free dev tools
Activated      [the first real value event]          20-50% of signups
Retained       activated again in week 2 / 4         30-60% of activated
Paid           subscription_started                  2-10% of activated
                                                     (freemium); 15-40%
                                                     of trials
Expanded       seats_added / plan_upgraded           –
Referred       invite_sent / referral_signup         –
```

*Ranges are wide because products differ; use them to spot a stage that is
wildly out of range, not as targets.

**The activation event is the most important definition you will make.**
It is the moment the user first gets the value the product promises: the
first types file generated; the first invoice sent; the first voice note
searched and found. Not "completed onboarding" (that is your checklist,
not their value). Pick it by looking at which early action best predicts
retention at day 30; if you have no data yet, pick the action that
corresponds to the one-liner and revise in a quarter.

Then compute the rates. The biggest drop is the thing to work on. A typical
early finding: 8% of visitors sign up (fine), 22% of signups activate
(bad). No amount of landing page work fixes that; the onboarding does.

## 3. North-star and input metrics

**The north-star** is one number that tracks the value delivered to users
and correlates with revenue. It is not revenue itself (lagging, and a
small team can't move it directly) and not signups (does not measure
value). Examples:

| Product | North-star | Why |
|---|---|---|
| Type generator | Weekly schemas with a passing CI check | Captures activation and retention; grows with teams adopting |
| Invoicing tool | Invoices paid through the product per week | Value to the customer, correlated with revenue |
| Voice notes app | Weekly users who searched and opened a note | The retention behaviour, not just recording |
| Dev collaboration tool | Weekly teams with 3+ active members | Team adoption predicts retention and expansion |

**Input metrics** are the three to five numbers you can actually move that
feed the north-star. For the invoicing tool: new firms activated per week
(acquisition plus onboarding), invoices per active firm (depth), payment
rate within 30 days (the product working), firm churn (retention). Each
input has an owner and a current value.

Review north-star and inputs weekly in ten minutes. Change the north-star
rarely; changing it every quarter means you never learn what moves it.

## 4. Event taxonomy and naming

Analytics data rots fastest through inconsistent naming: `signUp`,
`sign_up`, `Signup`, `user_registered` all in one dataset. Decide once,
write it in the repo, and enforce it in code review.

**Convention** (the most common and the one to default to unless the repo
already has another):

- `object_action` in snake_case, past tense for the action:
  `account_created`, `invoice_sent`, `types_generated`, `plan_upgraded`,
  `cta_clicked`.
- Objects are nouns from the product's domain model; actions are a small
  controlled set: `created`, `viewed`, `clicked`, `completed`, `sent`,
  `started`, `failed`, `deleted`, `upgraded`, `downgraded`, `invited`.
- Properties carry the detail, not the event name. One `cta_clicked` event
  with `{location: "hero", label: "Install", page: "/"}`, not
  `hero_cta_clicked`, `pricing_cta_clicked`, and so on.
- Property names also snake_case; values lowercase enums where possible.
- User properties (set once, updated rarely): `plan`, `signup_source`,
  `signup_date`, `company_size_band`, `role`. Not PII in analytics
  events; use the internal user id and keep PII in your own database.
- Group properties for B2B: `workspace_id`, `workspace_plan`,
  `workspace_seat_count`.
- Marketing site events in the same system as product events, keyed by
  anonymous id that is aliased to the user id at signup, so the funnel is
  one funnel.

**The tracking plan** lives in the repo (`analytics/events.md` or a typed
schema file) and lists every event, when it fires, its properties, and
which funnel stage or metric it serves. An event not on the plan does not
get added without updating the plan. Typed event helpers (a function per
event, with the properties typed) prevent most drift.

**Minimum event set** to start:

```
page_viewed            {path, referrer, utm_source, utm_medium, utm_campaign}
cta_clicked            {location, label, path}
signup_started         {method}
account_created        {method, source}
[activation event]     {…domain properties…}
[core action events]   3-6 events for the product's main verbs
plan_viewed            {path}
checkout_started       {plan, interval}
subscription_started   {plan, interval, amount}
subscription_cancelled {plan, reason?}
invite_sent            {}
email_link_clicked     {sequence_id, email_id}   (from the email tool)
```

Fire server-side where the event is a fact about the system (subscriptions,
generation runs) and client-side where it is about behaviour (views,
clicks). Server-side events are not blocked by ad blockers; for a developer
audience, 30-50% of client-side events are.

## 5. Attribution honesty

Attribution asks "which marketing caused this signup?" The honest answer is
usually "several things, and we can only see some of them."

What you can see: the last referrer before signup; UTM parameters on links
you controlled; a self-reported "how did you hear about us" answer. What
you cannot see: the podcast someone heard, the Slack message a colleague
sent, the HN thread they read on their phone and then searched for your
name on their laptop (which shows as "organic search" or "direct").

**Practical approach for a small team:**
- Tag every link you control with UTMs (`utm_source=newsletter`,
  `utm_medium=email`, `utm_campaign=oct-changelog`), consistently, from a
  shared sheet of allowed values.
- Capture first-touch (first referrer and UTMs, stored on the anonymous
  user) and last-touch (at signup). Store both; neither is "right".
- Ask at signup or in the welcome flow: "How did you hear about us?" with a
  free-text field (not a dropdown; the dropdown gets the first option).
  Read the answers monthly. This catches the dark social that UTMs miss,
  and it is often the most informative attribution data a small company
  has.
- Compare channels on what happens after signup (activation and
  retention), not on signups. A channel that sends 500 signups who never
  activate is worse than one sending 50 who do.
- Treat "direct" and "organic search for your brand name" as the result
  of everything else, not as channels.

**What not to do:** build or buy a multi-touch attribution model before you
have thousands of signups a month; it will produce confident numbers from
noise. Report ROAS on paid channels using platform-reported conversions,
which over-count by design (every platform claims the same conversion).
Argue about attribution when the real problem is activation.

## 6. Cohorts

A cohort is a group of users who started in the same period; tracking
cohorts separately shows whether the product is getting better or worse
for new users, which blended metrics hide.

**The retention table** (weekly signup cohorts down the side, weeks since
signup across):

```
Cohort      Users   W0     W1     W2     W3     W4     W8
Sep 1       84      100%   41%    33%    29%    27%    24%
Sep 8       91      100%   44%    35%    31%    28%    –
Sep 15      120     100%   52%    43%    38%    –      –
Sep 22      97      100%   49%    41%    –      –      –
Sep 29      133     100%   55%    –      –      –      –
```

Read: W1 retention is improving (41% to 55%) across cohorts, which suggests
the onboarding change in mid-September worked. The curve flattens around
W3-W4 at ~27-30%, which is the "retained" base; if it never flattens,
the product has not found its retained use yet.

Define "active" for retention as the activation event or a core action,
not a login. Use weekly cohorts for products used weekly, monthly for
monthly. Look at the table monthly; a single cohort is noisy at these sizes.

**Revenue cohorts**: same table with MRR instead of users, to see
expansion and contraction. Net revenue retention above 100% means
existing customers grow faster than they churn, which is the strongest
signal a B2B product can show.

## 7. Experiment design

An experiment is a change you make to learn whether it moves a metric. Most
"experiments" at small companies are changes with no hypothesis, no
pre-registered metric, and no way to tell signal from noise. Do fewer,
properly.

**Before running anything, write:**

```
Hypothesis:  Replacing the hero headline "Build faster" with "TypeScript
             types from your live Postgres schema" will increase visit-to-
             signup for visitors from HN and search, because the current
             headline does not say what the product is.
Metric:      visit-to-signup rate (primary); signup-to-activation
             (guardrail: must not drop)
Baseline:    3.1% over the last 8 weeks (n = 6,400 visits)
MDE:         we care about detecting a change to 3.7% or better
             (20% relative lift); smaller than that we would not act on
Sample:      ~8,000 visits per variant (section 8) at current traffic
             (~800/week) = ~20 weeks. Too long. Decision: run it as a
             sequential before/after over 4 weeks each and treat the
             result as directional, OR ship it on judgment (the current
             headline is clearly worse) and move on.
Duration:    full weeks only; include at least two weekends
Decision:    if lift ≥ MDE at 95%: keep. If no detectable effect: keep the
             new one anyway (it is more specific) and note it. If
             guardrail drops: revert.
Owner / date:
```

The honest version of that plan often ends with "we cannot detect this at
our traffic; we will ship on judgment." That is a legitimate outcome and
much better than running a six-week test and declaring a winner at 60%
confidence.

**What is worth testing** at low traffic (big expected effects):
positioning of the hero, the offer (free tier vs trial), the CTA action,
whether pricing is shown, the onboarding path, the activation email. **What
is not** (small effects you cannot detect): button colour, "Get" vs
"Start", image choice, font, most microcopy.

**Rules:**
- One variable per test. Two changes and a win tells you nothing.
- Randomize at the user (or workspace) level, not the pageview; a user who
  sees both variants is noise.
- Run full weeks; traffic and intent differ by weekday.
- Do not peek and stop on a good day; decide the duration or sample up
  front. If you must monitor, use a sequential testing method and accept
  it needs more samples.
- Log the test in a shared doc with the plan and the result, including
  "no detectable effect"; those are the most common result and the most
  forgotten.

## 8. Sample size sanity check

You do not need a statistics package to know whether a test is feasible. A
rule-of-thumb formula for comparing two conversion rates at roughly 95%
confidence and 80% power:

```
n per variant ≈ 16 × p × (1 − p) / (p₁ − p)²

where p  = baseline conversion rate (as a fraction)
      p₁ = the conversion rate you want to be able to detect
```

Worked examples:

| Baseline p | Detect p₁ | Relative lift | n per variant | At 800 visits/week, duration |
|---|---|---|---|---|
| 3.0% | 3.6% | +20% | 16 × 0.03 × 0.97 / 0.006² ≈ 12,900 | ~32 weeks for both variants |
| 3.0% | 4.5% | +50% | 16 × 0.0291 / 0.015² ≈ 2,070 | ~5 weeks |
| 25% (activation) | 30% | +20% | 16 × 0.1875 / 0.05² ≈ 1,200 | depends on signups/week; at 100/week, ~24 weeks |
| 25% | 35% | +40% | 16 × 0.1875 / 0.10² ≈ 300 | ~6 weeks at 100 signups/week |
| 40% (email click) | 48% | +20% | 16 × 0.24 / 0.08² ≈ 600 | one send to 1,200 recipients |

Reading these: with a few hundred visitors a week, only large effects on
the landing page are detectable in a reasonable time; activation changes
are detectable sooner because the base rate is higher; email tests are
detectable with a list of a couple of thousand. Plan tests where the math
works, and ship on judgment where it does not.

Also check the **minimum absolute count**: a test with fewer than ~100
conversions per variant is unreliable regardless of what the formula says,
because a handful of events swings the rate.

When reporting a result, give the interval, not the point: "variant B
converted at 3.9% vs 3.1%, 95% CI on the difference roughly −0.2 to +1.8
points; not conclusive" rather than "B won by 26%".

## 9. Reading dashboards without fooling yourself

Ways a dashboard lies to a small team, and the counter:

- **Small numbers, big percentages.** "Signups up 40%!" from 10 to 14. Show
  absolute counts next to every rate and ignore percentage moves on bases
  under ~100.
- **Weekly noise read as trend.** Three weeks is not a trend at these
  volumes. Use 4-week rolling averages for anything under a few hundred
  events a week, and compare to the same period last month, not last week.
- **Launch spikes in the average.** A Show HN week distorts every monthly
  number. Annotate the dashboard with launches, outages, and major
  changes, and look at the metric with the spike excluded too.
- **Blended rates hiding a mix shift.** Conversion "dropped" because a
  Reddit post sent a lot of low-intent traffic; conversion from the usual
  sources was flat. Always segment by source before concluding the product
  changed.
- **Survivorship in retention.** "Retention is up" because fewer people
  signed up, and the ones who did were more qualified. Check the cohort
  sizes.
- **Vanity metrics on the first screen.** Pageviews, followers, impressions,
  stars. Put the funnel rates and the north-star on the first screen; put
  vanity on the last or nowhere.
- **Confirmation.** You changed the headline and signups went up. Was there
  also a newsletter mention that week? Check the referrers before taking
  credit.
- **Simpson's paradox.** Conversion went up in every segment and down
  overall, because the mix shifted toward a low-converting segment.
  Segment first.
- **Metrics you cannot act on.** If a number moving would not change what
  you do next, remove it from the weekly view.

A good weekly dashboard for a small team has under ten numbers: visits by
source (top 5), visit-to-signup, signup-to-activation, W1 retention of the
latest complete cohort, north-star, MRR and net new MRR, and the one metric
of the current experiment. Everything else is for the monthly review.

## 10. Growth loops versus funnels

A funnel is linear: you pour in attention, some fraction converts, and you
pour in more next month. A loop is when the output of one cycle feeds the
input of the next: users create something that brings more users.

Loops available to small software products, with the condition for each:

| Loop | Mechanism | Works when |
|---|---|---|
| Content loop | Users ask questions; you answer in docs/posts; posts rank; new users arrive and ask questions | The product has a learnable domain and you can write |
| Open source loop | Users adopt; some contribute; the project improves and is mentioned; more adopt | The project is genuinely open and contribution is easy |
| Artifact loop | Users produce something public with your product (a page, a badge, a "powered by", an export) that others see | The output is naturally shared (invoices, published pages, generated reports, embeds) |
| Collaboration loop | A user invites teammates or clients to use the product with them | The product is better with others (approvals, shared workspaces) |
| Integration loop | Being listed in another product's marketplace brings users who then ask for more integrations | There are popular adjacent tools with directories |
| Referral loop | Users refer for a reward | Value is clear quickly and the reward is in-kind (credits, seats), not cash; weakest loop for B2B dev tools |

The invoicing tool has a natural artifact loop: every invoice and approval
email a client receives has a small "Sent with Invoicely" line (with the
customer's consent and an option to remove on paid plans). The type
generator has a content and open source loop. The voice notes app has a
weak sharing loop (shared transcripts) and mostly a funnel.

Design for the loop that fits; do not force a referral program on a
product with no sharing moment. Measure a loop by its cycle metric (invites
per active workspace; contributors per 1,000 stars; signups attributed to
"powered by" links) and improve that.

## 11. Pricing experiments

Pricing is the highest-leverage variable and the most dangerous to
experiment on. Reasons for caution:

- **Fairness and trust.** Showing different prices to different visitors
  for the same product is legal in most places but becomes a story when
  discovered ("I was quoted $29 and my colleague $19"). For a small company
  with a community, the reputational cost can exceed the learning.
- **Sample sizes.** Purchase rates are low; a pricing test needs more
  traffic than a headline test, and most small products cannot run one
  with meaningful power.
- **Long feedback loop.** The right price optimizes retention and
  expansion, not just conversion; a lower price that converts better and
  churns faster looks like a winner for three months.

Safer approaches:
- **Test packaging, not price.** Which features sit in which tier; whether
  the free tier exists; annual toggle presence. These are legitimate to
  vary and less likely to be perceived as unfair.
- **Change price for new customers only, sequentially.** Announce it;
  grandfather existing customers. Compare cohorts before and after. This
  is how most small companies find their price.
- **Ask.** Van Westendorp-style surveys (at what price is it too cheap to
  trust, a bargain, getting expensive, too expensive) on a few dozen
  users give a usable range. Interviews with ten customers about what
  they compared the price to tells you the anchor.
- **Raise prices more often than you think.** Most small B2B products are
  underpriced; a 20-30% increase for new customers rarely moves conversion
  detectably and immediately raises revenue per customer.

If you do A/B test a price: same price for everyone in a workspace;
honour the lower price for anyone who saw it; keep the test short; do not
test more than two points; and be prepared to explain it publicly.

## 12. Tooling and privacy

Match what the repo already has; look for `gtag`, `gtm`, `plausible`,
`fathom`, `umami`, `posthog`, `mixpanel`, `amplitude`, `segment`,
`rudderstack`, `june`, `heap` in the frontend and server code, and for
existing event helper modules.

Reasonable defaults for a small team if nothing exists: a privacy-focused
site analytics tool that needs no cookie banner in most jurisdictions
(Plausible, Fathom, Umami, Simple Analytics) for the marketing site, plus
a product analytics tool with funnels and cohorts (PostHog, which can also
replace the site tool and is self-hostable; or Mixpanel/Amplitude free
tiers) for the app. Server-side event sending for the facts that matter.

Privacy and consent: analytics that set identifying cookies or track
across sites need consent under GDPR/ePrivacy for EU visitors; the
privacy-focused tools are designed to avoid this. Product analytics inside
the app, tied to the account, is generally covered by the privacy policy
and legitimate interest or contract, but disclose it plainly and offer
opt-out where feasible. Developer audiences notice and resent heavy
trackers on a marketing site. Full detail in `claims-and-compliance.md`.

## 13. Reporting

Weekly (ten minutes, the team): the under-ten-number dashboard, the
experiment in flight, one sentence on what changed and why.

Monthly (an hour): cohorts, channel comparison by activation, "how did
you hear about us" read-through, Search Console (per `seo-content.md`),
email metrics, the content calendar's results column, what to do
differently next month.

Quarterly: north-star trend, inputs that moved and did not, experiments
run and learned, the funnel's biggest drop now versus a quarter ago,
strategy adjustments.

Write it down each time. A team that cannot say what it learned last
quarter from its analytics is paying for a dashboard to look at.

## 14. Failure modes

- **No activation event defined.** Everything downstream is unmeasurable.
- **Inconsistent event names.** Data unusable within six months.
- **Optimizing signups while activation is 20%.** Pouring more into a
  leaking bucket.
- **Attribution modelling at 50 signups a month.** Confident numbers from
  noise.
- **Declaring A/B winners at p = 0.3.** Coin flips reported as learnings.
- **Testing button colours at 500 visits a week.** Undetectable by
  construction.
- **Reading weekly swings as trends.** Three weeks is noise at these
  volumes.
- **Dashboards of vanity.** Followers and pageviews on the first screen;
  the funnel nowhere.
- **Blended rates without segmentation.** Mix shifts read as product
  changes.
- **Pricing A/B tests on a small community product.** The learning is
  smaller than the story.
- **No annotations.** A launch spike in the average forever, unexplained.
- **Never writing it down.** The same question re-investigated every
  quarter.
