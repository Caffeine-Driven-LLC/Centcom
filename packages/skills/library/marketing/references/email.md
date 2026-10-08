# Email

Lifecycle and newsletter email for a software product: the lifecycle map
(welcome, onboarding, activation nudges, trial expiry, win-back), full
example sequences with complete emails, subject line craft, plain text
versus designed, deliverability basics (SPF, DKIM, DMARC, warming, list
hygiene), consent and unsubscribe compliance, and newsletter format and
cadence. Compliance detail is in `claims-and-compliance.md`; this file
gives the operational version.

## Contents

1. Why email still matters for a small product
2. The lifecycle map
3. Principles for lifecycle email
4. Sequence: welcome and onboarding (free signup)
5. Sequence: trial
6. Sequence: activation nudges (behaviour-triggered)
7. Sequence: win-back
8. Transactional emails that do marketing work
9. Subject lines
10. Plain text versus designed
11. Deliverability
12. Consent, unsubscribe and the legal minimum
13. Newsletters: format and cadence
14. Tooling and the handoff
15. Failure modes

## 1. Why email still matters for a small product

Email is the one channel you own. Platforms change algorithms; search
changes; the list stays. For a software product, the emails that matter
most are not the newsletter but the lifecycle messages: the welcome email
has the highest open rate any email will ever get (often 50-80%), the
activation nudge is the cheapest retention lever available, and the trial
expiry email is where revenue happens. A team that has no newsletter but a
sharp five-email onboarding sequence is doing email right.

## 2. The lifecycle map

```
Stage           Trigger                         Goal of the email(s)
─────────────── ─────────────────────────────── ────────────────────────────
Waitlist        signed up pre-launch            confirm; set expectation; one
                                                 update at launch
Welcome         account created                 get to first action; set
                                                 expectations; who to reply to
Onboarding      day 1-14 after signup           one capability per email, in
                                                 the order that builds value
Activation      did NOT do the key action by    one specific nudge with the
nudge           day N (behavioural)             exact next step
Trial expiry    3 days, 1 day, 0 days before    make the decision easy; show
                                                 what they did; plain pricing
Conversion      upgraded / paid                 thank; what changes; who to
                                                 call
Engagement      ongoing, monthly                changelog / what's new, only
                                                 what matters to them
Expansion       hit a limit; used a feature     the plan that fits; no
                that implies a need             pressure
Win-back        churned / inactive 30-90 days   one honest email; one ask
Re-permission   list inactive 12+ months        confirm they want to stay or
                                                 remove
```

Each stage has one or a few emails; each email has one job and one link.
Design the triggers from product events (see `analytics-and-growth.md` for
the event taxonomy); time-based sequences that ignore behaviour send "have
you tried feature X" to people who used it yesterday.

## 3. Principles for lifecycle email

- **One job, one link.** Each email asks for one thing. A second link is
  for the person who cannot do the first.
- **From a person.** "Ana at pgtypes" with a real reply-to that a human
  reads. Replies are the best feedback channel a small team has; do not
  waste them on noreply@.
- **Short.** Under 150 words for most lifecycle emails. The reader is on a
  phone between tasks.
- **Know what they did.** Use product state: "You created a project but
  haven't connected a database yet." Generic sequences that ignore
  behaviour are ignored.
- **Plain language, plain text.** See section 10.
- **Say what happens next and when.** "You'll get three more emails this
  week, then only when there's something worth saying."
- **Make leaving easy.** A visible unsubscribe, and for sequences, a "stop
  the onboarding emails" link separate from the global unsubscribe.
- **Never open with "I hope this finds you well"** or "I'm reaching out".
  The first sentence is the reason for the email.
- **Measure to the action, not the open.** Opens are unreliable (Apple Mail
  Privacy Protection inflates them). Measure clicks and, better, the
  product event the email was meant to cause.

## 4. Sequence: welcome and onboarding (free signup)

For a developer tool with a free tier. Triggers are events; "Day" is the
default timing if the event has not happened.

**Email 1, immediately: Welcome**

```
Subject: Your pgtypes account, and the one command to run

Hi Jonas,

Thanks for signing up. Here's the one thing to do next:

    npx pgtypes gen --url $DATABASE_URL --out src/db/types.ts

That reads your schema and writes a types file. On a typical schema
it takes under a second. The quickstart has the three common setups
(Postgres.js, Kysely, pg): https://pgtypes.dev/docs/quickstart

If it fails or produces something odd, reply to this email with the
error. I read every reply.

You'll get a few more emails this week about what pgtypes does; after
that, only the changelog if you want it.

Ana
pgtypes
```

Why it works: the first line is the next action; the action is one line
long; the fallback (reply with the error) turns failure into a
conversation; expectations about volume are set.

**Email 2, day 2, only if `types_generated` has NOT fired: first nudge**

```
Subject: Did the generate command run?

Jonas, I noticed no types file has been generated from your account
yet. The three most common reasons, and the fix for each:

1. Connection string format. Postgres URLs need sslmode for most
   hosted databases: postgres://user:pass@host/db?sslmode=require
2. Permissions. The role needs SELECT on information_schema and
   pg_catalog; here's the one-line GRANT: [link]
3. You're using a migrations folder, not a live DB. Use
   --migrations ./migrations instead of --url.

If it's none of these, reply with the error and I'll look.

Ana
```

**Email 2 alt, day 2, if `types_generated` HAS fired: the next value**

```
Subject: Your types can't drift now. Here's the CI step.

Nice, types generated. The reason most teams keep pgtypes is the CI
check: it regenerates on every PR and fails the build if the types
changed without a commit. That catches the renamed column before
production does.

It's one step in your workflow file:

    - run: npx pgtypes gen --url ${{ secrets.DATABASE_URL }} --check

Full example for GitHub Actions and GitLab: [link]

Ana
```

**Email 3, day 5: the differentiator**

```
Subject: Postgres enums, arrays and jsonb, typed properly

The thing people switch to pgtypes for is Postgres-specific types.
Enums become string literal unions; arrays become T[]; jsonb can be
typed with a schema file so you're not stuck with unknown.

Two-minute walkthrough with a real schema: [link]

Ana
```

**Email 4, day 9: social proof plus the honest limit**

```
Subject: How a 4-person team uses pgtypes (and what it doesn't do)

Miro's team at Flowstep moved off Prisma in a week. The short version
of what they did and what they hit: [link to the case study]

Also, what pgtypes doesn't do: it won't write your queries, it won't
run migrations, and it's Postgres only. If you need those, Drizzle is
good; here's how people use the two together: [link]

Ana
```

**Email 5, day 14: the close of the sequence**

```
Subject: Last onboarding email

That's it for the onboarding emails. From here you'll get the
monthly changelog if you're on it (you can switch it off here:
[link]) and nothing else.

Two questions, if you have a minute to reply:
- What were you using before pgtypes?
- What almost stopped you from trying it?

Those two answers shape what we build next.

Ana
```

The sequence is five emails over two weeks, each under 150 words, each
with one action, branched once on the key behaviour. For a B2B product,
the same shape applies with the activation event changed (e.g. "sent
first invoice") and email 4 addressing the buying committee ("here's the
one-pager for your finance lead").

## 5. Sequence: trial

For a 14-day paid trial. Prefixed by the welcome/onboarding sequence above
(compressed to days 0-7). The trial-specific emails:

**Day 10, 4 days before expiry: the status email**

```
Subject: Your trial ends Friday. Here's what you've done so far.

Priya, your Invoicely trial ends on Friday the 17th.

In 10 days you've:
- Sent 12 invoices totalling £8,400
- Had 9 of them paid; average 6 days to payment
- Sent 7 automatic reminders (you wrote zero of them)

If that's useful, Studio is £12 per seat per month; at your 3 seats
that's £36. Upgrade here and nothing changes: [link]

If it isn't, your data exports as CSV any time: [link]. No hard
feelings.

Ana
```

Why: the numbers are theirs, from product events; the price is stated
with the arithmetic done; the exit is as easy as the upgrade.

**Day 13, 1 day before: the short one**

```
Subject: Trial ends tomorrow

Priya, one day left. Upgrade to keep the reminders going: [link]

If you're on the fence about something specific, reply and tell me
what; I'd rather fix it than lose you.

Ana
```

**Day 14, expiry: what happens now**

```
Subject: Your trial has ended (your data is safe)

Your Invoicely trial ended today. Your invoices and clients are still
here, read-only, for 30 days. Scheduled reminders are paused.

To pick up where you left off: [link]
To export everything: [link]

Ana
```

**Day 21, one week after: the single follow-up**

```
Subject: One question

Priya, you tried Invoicely and didn't continue. Totally fine. Would
you tell me why, in a sentence? Price, a missing feature, timing,
something else. It genuinely changes what we build.

Ana
```

Do not send a "50% off if you come back now" email as the default; it
teaches customers to wait for discounts and signals the price was never
real. A discount for a specific stated reason ("you said price; here's the
annual plan that works out to £10/seat") is different.

## 6. Sequence: activation nudges (behaviour-triggered)

These fire from product events, not days. Each addresses one stall with one
fix. Build the list from your funnel's biggest drop-offs
(`analytics-and-growth.md`).

| Stall (event absent after N) | Email job |
|---|---|
| Signed up, no project created (24h) | The one-click create; what a project is |
| Project created, no data connected (48h) | The connection string guide; common errors |
| Data connected, no first output (24h) | The command; expected output; reply-with-error |
| First output, no second use (7 days) | The CI step (the habit-forming use) |
| Invited no teammates (14 days, team plan) | Why the second seat matters; the invite link |
| Hit the free limit (immediately) | What the limit is, what the next plan costs, the arithmetic |

Format: subject names the stall plainly ("Your database isn't connected
yet"); first line is the fix; one link; the reply-with-error fallback.

Cap the nudges: at most one per 48 hours per user, and stop after three
unanswered nudges; a fourth is nagging.

## 7. Sequence: win-back

For users inactive 60-90 days (define inactive from a product event).

**One email**, not a sequence:

```
Subject: What changed since you left

Hi Tom,

You used pgtypes back in June and then stopped; that usually means we
were missing something or it broke. Since then:

- Views and materialized views are supported (the top request)
- `--watch` mode, ~40ms per regeneration
- Supabase and Neon guides

If one of those was your reason, it's one command to pick it up again:
[link]. If it was something else, reply and tell me; I'd like to know.

If you'd rather not hear from us, this unsubscribes you from
everything: [link]

Ana
```

Why one email: a win-back sequence of five emails to someone who left is
how you get spam complaints, which hurt deliverability for everyone else
on the list. One honest email, then let them go.

## 8. Transactional emails that do marketing work

Transactional emails (receipts, password resets, invoice sent, export
ready) are opened at rates marketing emails never see. Do not stuff them
with promotions (it is also a legal line in several jurisdictions), but
make them good:

- The receipt names what was bought in plain terms and links to the thing
- The "invoice sent to your client" notification shows the client-facing
  view (reassurance that it looked professional)
- The "export ready" email is friendly, not robotic
- Each has the same sender name and voice as the lifecycle emails
- Each has a one-line footer: "Questions? Reply to this email."

A product with excellent transactional emails and no newsletter is ahead
of most.

## 9. Subject lines

The subject line's job is to make the email worth opening to this person
now. Rules of thumb:

- **Say what is inside.** "Your trial ends Friday" beats "Important
  account update". Clarity beats cleverness in lifecycle email; clever
  subject lines are for newsletters, sparingly.
- **Under 50 characters** so it survives a phone preview.
- **Specific over generic.** "Postgres enums, arrays and jsonb, typed
  properly" over "Discover advanced features".
- **No fake urgency, no "RE:", no "FWD:", no ALL CAPS, no emoji in B2B.**
  These are spam filter signals and reader-trust destroyers.
- **Personalization in the subject** ("Jonas, ...") has small, inconsistent
  effects; personalization in the body (what they did) has large ones.
- **Preheader** (the preview text after the subject): write it; it is the
  second line of the subject. Do not let it default to "View in browser".
- **Test subject lines only at volume.** With under 2,000 recipients, the
  difference between two subject lines is noise.

Bank, lifecycle:
- "Your pgtypes account, and the one command to run"
- "Did the generate command run?"
- "Your types can't drift now. Here's the CI step."
- "Your trial ends Friday. Here's what you've done so far."
- "Trial ends tomorrow"
- "Your trial has ended (your data is safe)"
- "One question"
- "What changed since you left"
- "You hit the 3-project limit"
- "Last onboarding email"

Bank, newsletter/changelog:
- "October in pgtypes: views, --watch, and a 10x faster introspect"
- "We broke enums in 0.4.0. Here's the fix and the postmortem."
- "Three ways teams are using the CI check"
- "pgtypes 1.0"

## 10. Plain text versus designed

Plain text (or nearly: a logo at most, system fonts, one link colour) wins
for lifecycle and founder emails because: it reads as a message from a
person; it renders everywhere including dark mode; it is less likely to be
filtered to Promotions; and it is faster to write and change. Deliverability
folklore says plain text also lands in the inbox more often; the evidence
is mixed, but the trust effect is real.

Designed HTML (templates, images, buttons, columns) is appropriate for:
newsletters with multiple items, product announcements with screenshots,
consumer products where brand feel matters, receipts where a structured
table helps.

If designed:
- Single column, 600px max width, 16px+ body text, generous line height
- Buttons as bulletproof HTML/CSS, not images; the link also in text
- Images with alt text, since images are blocked by default in many
  clients; the email must make sense with no images
- Dark mode tested (Apple Mail and Gmail invert differently)
- Tested in Gmail web, Gmail mobile, Apple Mail, Outlook desktop (the
  renderer that breaks everything)
- Total size under 100KB or Gmail clips it
- Use MJML or react-email rather than hand-writing table layouts; the
  design skill owns how it looks, this skill owns what it says

Either way: the text version is written, not auto-generated garbage, and
the first line of the body works as the preview.

## 11. Deliverability

Deliverability is whether the email reaches the inbox. For a small sender it
is mostly about authentication, reputation and list quality.

**Authentication (set up before the first send):**
- **SPF**: a TXT record listing the servers allowed to send for your domain.
  Your email provider gives the include; combine into one record (multiple
  SPF records break SPF).
- **DKIM**: cryptographic signature; the provider gives CNAME records to add.
  Use 2048-bit keys.
- **DMARC**: a TXT record at `_dmarc.yourdomain` telling receivers what to do
  with mail that fails SPF/DKIM. Start with `p=none; rua=mailto:...` to
  collect reports, move to `p=quarantine` then `p=reject` once you have
  confirmed all legitimate senders pass. Gmail and Yahoo require DMARC for
  bulk senders (5,000+/day) and require alignment.
- **Use a subdomain for marketing mail** (`mail.yourdomain.com` or
  `news.yourdomain.com`) so a reputation problem on marketing does not
  affect transactional or human mail from the root domain. Transactional
  mail on another subdomain (`notify.`). Human mail stays on the root.
- **BIMI** (logo in inbox) requires DMARC at enforcement and, for Gmail, a
  Verified Mark Certificate; nice to have, not a priority.

**Warming**: a new domain or IP that suddenly sends 10,000 emails looks
like a spammer. Ramp: start with the most engaged recipients (recent
signups, people who reply), a few hundred a day, doubling every few days
over two to four weeks. Most providers (Postmark, Resend, SES, Customer.io,
Loops) handle IP warming on shared pools; domain reputation is still yours
to warm.

**List hygiene:**
- Confirmed opt-in (double opt-in) for newsletters; it costs some signups
  and saves your reputation
- Remove hard bounces immediately (automatic in most tools)
- Suppress anyone who has not opened or clicked in 6-12 months, after one
  re-permission email ("Still want these? Click to stay; otherwise we'll
  remove you")
- Never buy, scrape or import a list you did not collect with consent;
  beyond the legal issue, it destroys deliverability for your real list
- Watch the complaint rate: above 0.1% (one per thousand) is a problem;
  above 0.3% Gmail starts filtering you
- Set up Google Postmaster Tools and Microsoft SNDS to see your domain
  reputation

**Content signals** that trip filters: ALL CAPS, excessive punctuation,
URL shorteners, image-only emails, mismatched link text and destination,
"free!!!", a sending domain that does not match the From address.

**Monitoring**: bounce rate under 2%, complaint rate under 0.1%, and check
inbox placement by sending to seed accounts at Gmail, Outlook, Yahoo and
iCloud before each campaign.

## 12. Consent, unsubscribe and the legal minimum

Full treatment in `claims-and-compliance.md`. Operational summary:

- **Marketing email needs consent** in the EU/UK (GDPR, PECR: opt-in,
  except a narrow "soft opt-in" for existing customers for similar
  products), Canada (CASL: express or implied consent with records), and is
  opt-out in the US (CAN-SPAM) but Gmail/Yahoo bulk-sender rules effectively
  require one-click unsubscribe anyway.
- **Transactional email** (receipts, password resets, service notices) does
  not need marketing consent, and must not be used to carry marketing
  content to people who have not consented.
- **Onboarding emails** are a grey zone: emails necessary to use the service
  the person signed up for are generally fine; "here's a feature you might
  like" is marketing. Err toward a visible, easy opt-out for the onboarding
  sequence itself.
- **Every marketing email**: visible unsubscribe link that works in one or
  two clicks with no login; a physical mailing address (CAN-SPAM); the
  sender's identity; honest subject line. Honour unsubscribes within 10
  days (CAN-SPAM) and immediately in practice.
- **List-Unsubscribe headers** (RFC 8058 one-click) are required by Gmail
  and Yahoo for bulk senders; your provider sets them if you let it.
- **Records**: when and how each person consented; your tool should store
  this.
- **Never pre-tick** the marketing consent box; never bundle it with the
  terms; never make the "no" option harder to find than the "yes".

## 13. Newsletters: format and cadence

Only start a newsletter when there is something to say regularly and
someone to write it. A newsletter that goes quiet for four months and then
sends is worse than none; the list has forgotten who you are, and the
spam complaints follow.

**Formats that work for a small software product:**
- **The monthly changelog digest**: what shipped, the one thing to try,
  one thing coming. 200-400 words. Easiest to sustain because the content
  already exists.
- **The build log**: what we worked on, what we learned, a number. Founder
  voice. Works for build-in-public audiences.
- **The curated niche digest**: five links in your category with a
  sentence each, plus one line about your product. Hard to sustain, but
  the most shared format because it is useful regardless of the product.
- **The essay**: one idea a month, with the product mentioned once if
  relevant. Works if the founder can write; builds the strongest audience;
  slowest to show results.

**Cadence**: monthly is sustainable for almost everyone; fortnightly if
you have a changelog that moves; weekly only if it is someone's job. Pick
the cadence you can hold for a year and tell subscribers what it is.

**Structure**: a first line that could stand alone (it is the preview);
the one most important item first; scannable sub-heads; one primary link;
a plain footer with unsubscribe, address, and "reply to this email".

**Length**: 300-600 words for a digest; an essay is as long as it needs,
with a 40-word summary at the top.

**Signup copy**: say what it is, how often, and what it is not. "Monthly:
what shipped in pgtypes and one thing worth knowing about Postgres types.
No other emails." Signup conversion rises when the frequency is stated.

**Metrics**: click rate (not open rate, for the Apple MPP reason),
unsubscribe rate per send (above 0.5% means the content or cadence is
wrong), replies, and whether a send moved the product metric it mentioned.

## 14. Tooling and the handoff

Match the repo's existing provider; look for `resend`, `postmark`,
`@sendgrid`, `nodemailer`, `aws-sdk/client-ses`, `customerio`, `loops`,
`mailchimp`, `convertkit` in dependencies and env files, and `emails/`,
`react-email`, `mjml`, `*.mjml`, `templates/email` directories.

Deliver sequences to engineering as a table:

| ID | Trigger event / condition | Delay | Suppress if | Subject | Template | Primary link / event |
|---|---|---|---|---|---|---|
| onb-1 | `account_created` | 0 | | Your pgtypes account, and the one command to run | onb-1.md | docs/quickstart; measure `types_generated` within 48h |
| onb-2a | `account_created` | 48h | `types_generated` fired | Did the generate command run? | onb-2a.md | docs/connection; measure `types_generated` |
| onb-2b | `types_generated` | 24h | `ci_check_configured` fired | Your types can't drift now. Here's the CI step. | onb-2b.md | docs/ci; measure `ci_check_configured` |

With the global rules: max one lifecycle email per 48h per user; stop the
sequence on upgrade or on sequence-unsubscribe; all sends respect global
unsubscribe; from name and reply-to; sending subdomain.

## 15. Failure modes

- **Opening with "I hope this finds you well" / "I'm reaching out."** Three
  sentences of nothing; the reader has closed it.
- **Time-based sequences that ignore behaviour.** "Have you tried X?" to
  someone who used X yesterday reads as a bot, because it is.
- **Multiple CTAs per email.** The reader clicks none.
- **noreply@ as the sender.** You just told them you do not want to hear
  from them.
- **Newsletters that recap the blog.** If they wanted the blog, they would
  read the blog. Give them something only the email has.
- **Designed templates for a founder message.** A two-column HTML template
  from a two-person team reads as a mailing list, not a person.
- **No authentication.** Mail goes to spam from day one and the team
  blames the copy.
- **Buying or scraping a list.** Illegal in most places, and it burns the
  domain for the real list.
- **Discount as the default win-back.** Teaches customers to churn and wait.
- **Four-email win-back sequences.** Spam complaints.
- **Hidden or multi-step unsubscribe.** Illegal, and the complaint button is
  easier than your unsubscribe, so they use it.
- **Measuring opens.** Apple Mail Privacy Protection made open rates
  fiction; measure clicks and product events.
- **Launching a weekly newsletter.** Dead by week six. Monthly, held for a
  year, wins.
