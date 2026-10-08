# Launch

How a small team launches a software product without an audience, a budget
or a PR firm. Plan templates by stage with timelines, a realistic Product
Hunt playbook, Hacker News norms (Show HN, what gets flagged), Reddit norms
by subreddit type, X and LinkedIn launch threads, newsletter outreach,
press for small teams, a launch day checklist, post-launch follow-through,
and how to measure whether the launch worked.

## Contents

1. What a launch is for a small team
2. Launch plan by stage
3. The pre-launch list
4. Product Hunt, realistically
5. Hacker News: Show HN and comments
6. Reddit by subreddit type
7. X, Bluesky, LinkedIn threads
8. Newsletter and community outreach
9. Press for small teams
10. Launch day checklist
11. Post-launch follow-through
12. Measuring a launch
13. Failure modes

## 1. What a launch is for a small team

A launch is a concentrated attempt to get the right few hundred people to
try the product in the same week, so that the feedback, the proof and the
first word-of-mouth all arrive together. It is not the moment the product
becomes known; most successful products launch several times (alpha,
public, v1, each major feature, each platform). Treat the launch as the
first of many and plan the second one before the first is over.

Realistic outcomes for a two-person team with no audience: a Show HN that
reaches the front page brings 5,000-30,000 visits over two days and a
signup rate of 2-8% for a free developer tool; a Product Hunt top-five
finish brings 2,000-10,000 visits with a lower-intent audience; a Reddit
post in the right subreddit brings 500-5,000. Most launches do not reach
those numbers. Plan for the median case: a few hundred visitors from each
channel, a few dozen signups, five pieces of useful feedback and two
people who become advocates. That is a good launch for week one.

The things that make a launch work are mostly done before launch day: the
product installs cleanly, the page answers the first question, the
founder is available to answer comments for 12 hours, and there is a list
of people who said they would look.

## 2. Launch plan by stage

### Pre-launch (nothing public yet)

Goal: a list of people who want to be told, and a product that survives a
stranger.

```
T-8 weeks   Positioning and messaging done (positioning.md). One-page site
            with the one-liner, what it does, and an email field.
            Set up analytics with named events (analytics-and-growth.md).
T-6 weeks   Start building in public where the audience is: 2-3 posts a
            week on the platform your ICP uses (social-and-community.md).
            Show the thing, not the plan. Each post links the waitlist.
T-6 weeks   Private alpha: 10-20 users from the waitlist, hand-recruited.
            Weekly calls. Fix what they hit. Collect quotes with permission.
T-4 weeks   Write the launch assets: Show HN post, PH listing, launch
            thread, the "why we built this" post, the welcome email.
            Record the demo (under 90 seconds; the real product).
T-3 weeks   Line up 10-30 "day one" people who agreed to try it and
            comment honestly. Not to upvote. To comment.
T-2 weeks   Press and newsletter outreach (sections 8 and 9). Soft embargo
            for launch day.
T-1 week    Freeze features. Fix the install path on a clean machine.
            Load test the signup. Write the status post for if it breaks.
T-1 day     Everything scheduled or drafted. Sleep.
```

Waitlist copy that works: say what it is, when it ships (a month, not a
date you will miss), and what joining gets them (early access, not
"exclusive updates"). "We'll email you once when it's ready, and not
otherwise" raises signups.

### Launched (public, some users, little proof)

Goal: turn the first users into proof, and re-launch with it.

```
Week 1-2    Answer every comment, issue and email within hours. Ship fixes
            daily and say so publicly ("Fixed the Windows install from the
            HN thread").
Week 2-4    Ask the engaged users for a quote, a call, or a case study.
            Publish the first "how X uses it" post.
Week 4-8    Second launch: a major feature, a platform, a v1.0. Smaller
            channels (newsletters in the niche, a second subreddit).
Ongoing     Changelog every release (developer-marketing.md); one
            substantial post a month that would stand without the product.
```

### Growing (proof exists)

Goal: launches as a recurring motion, not events. Monthly or quarterly
"what's new" launches (Linear-style), each with a changelog post, a thread,
an email to users, and a PH launch for the big ones. Use the proof you now
have: numbers, customer stories, benchmarks. Add paid amplification only
when a channel has already worked organically.

## 3. The pre-launch list

The single highest-leverage launch asset is a list of real people. Build it
from:

- Everyone who starred, forked or opened an issue (public; you can @mention
  on launch, carefully, or email if they opted in)
- Waitlist signups
- People who replied to build-in-public posts
- Alpha users
- Friends in the industry who said "tell me when"
- Newsletter writers and community moderators in the niche who you have
  already given something to (a useful reply, a contribution, a tip)

For each: name, where you know them from, what you will send them, and the
date. Twenty genuine people who comment substantively on launch day beat
two hundred upvotes from a Slack group, and the platforms' ranking
algorithms increasingly detect the latter.

Never ask for upvotes. Ask people to look and say what they think, in
public if they want to. This is the norm on every platform and it is also
what actually helps.

## 4. Product Hunt, realistically

What Product Hunt is in 2026: a directory where a top-five daily finish
gives a badge, a few thousand visits of mixed quality (makers, marketers,
other founders, some buyers), a backlink, and a reason for people in your
list to look at the product on one day. It is not a growth channel for most
developer tools; it is a decent one for consumer apps, design tools,
no-code and productivity products, and anything other founders would use.

The listing:
- **Tagline** (60 characters): the one-liner. "Voice notes you can search,
  transcribed on-device." Not "Your AI-powered second brain".
- **Description** (260 characters): expanded one-liner plus the mechanism.
- **First comment** (from the maker): the story in 150-300 words: why you
  built it, what it does, what it does not do yet, what you want feedback
  on. Honest and specific; this comment sets the tone of the thread.
- **Gallery**: 4-6 images; the first is the product doing the thing, with a
  short caption. A 30-60 second video that shows the product, not a logo
  animation.
- **Topics**: pick the 3 that match your ICP, not the 3 most popular.

Launch mechanics:
- Launch at 12:01am Pacific (the PH day starts then). Tuesday to Thursday
  is conventional; the evidence for which weekday is weak.
- A "hunter" with a following used to matter; today it matters little.
  Launch it yourself unless a relevant hunter asks.
- Be online for the full 24 hours or split it with a cofounder. Reply to
  every comment within the hour. The comment count is a ranking input and
  a credibility signal.
- Tell your list in the morning of their time zone, with a direct link, and
  ask them to try it and leave an honest comment. Do not say "upvote".
- Post the launch on your other channels at their peak hours, not at
  12:01am.
- Ignore the "upvote groups" and vote-exchange offers that will arrive in
  your DMs. They violate PH's rules and the algorithm down-weights the
  resulting votes.

Realistic expectations: a #1 product of the day in a quiet week might get
600-1,200 upvotes and 5,000-15,000 visits; #5 maybe 300 upvotes and 2,000
visits; a product that gets 80 upvotes and ten real comments from the right
people has had a useful day. Conversion from PH traffic is usually lower
than from HN or search because the audience is browsing.

After: add the badge to the site only if the ranking was top five; "Featured
on Product Hunt" with a #47 finish is a tell. Reply to late comments for a
week. Use the quotes with permission.

## 5. Hacker News: Show HN and comments

Hacker News is the single most valuable launch channel for developer tools,
and the one with the strictest unwritten rules. Read the Show HN guidelines
(news.ycombinator.com/showhn.html) before posting; the summary here is the
practical layer.

**What qualifies as Show HN:** something people can try: a running app, a
repo they can install, a demo. Not a landing page with a waitlist (that is
a normal submission, and usually dies). Not a blog post about a product
(submit the post without the Show HN prefix).

**Title:** "Show HN: Name – one-line plain description". Under 80
characters. Plain, lower-key than any other channel. Compare the front page
on the day; the register is descriptive and slightly understated. Examples
that fit the register:

- "Show HN: pgtypes – TypeScript types from a live Postgres schema, no ORM"
- "Show HN: I built a voice memo app that transcribes and searches on-device"
- "Show HN: Invoicing that chases late payers for you (for small services firms)"

Examples that will be rewritten by moderators or flagged by users:
- "Show HN: The future of database tooling is here"
- "Show HN: 🚀 Supercharge your invoicing with AI"
- "Show HN: We raised $2M to fix invoicing" (fundraising is not Show HN)

**The text or first comment:** the story in the founder's voice, 200-400
words: what it is, why you built it (the specific failure), how it works
(the mechanism; HN readers want it), what it does not do, what you are
unsure about, a direct link. Technical detail is rewarded. Admit the
limitations before someone else finds them; "known gaps: no MySQL, Windows
install is rough" is read as credibility.

**Timing:** weekday mornings US Eastern (roughly 7-10am ET) give the most
hours of US daytime for the post to climb. Weekends have less traffic but
less competition; Show HN posts do fine on weekends. Do not resubmit the
same thing within weeks; if it dies, email the moderators (hn@ycombinator.com)
and ask for the second-chance pool, which they offer for good Show HNs that
got no traction.

**What gets flagged or killed:**
- Marketing language in the title or text
- A landing page with no way to try it
- Required signup before seeing anything (a dev tool that demands an email
  to read the docs will be flagged in the first comment)
- Visible astroturfing: a burst of new accounts upvoting, or comments from
  colleagues pretending to be users (HN detects voting rings and penalizes
  the post)
- Asking for upvotes anywhere, including on your own social accounts (HN
  moderators watch for this; it is specifically against the rules)
- Not responding to comments
- Arguing with critics

**In the thread:** be there for 10-12 hours. Answer every substantive
question with substance. Thank people for bugs and fix them live if you
can ("Fixed in 0.3.1, thank you"). When someone says "why not just use X",
answer with the honest comparison, including where X is better. When
someone is hostile, answer the content once, politely, and stop. The
thread is your landing page for the day; most readers read the comments
before clicking the link.

**What success looks like:** front page for a few hours brings 5,000-30,000
visits, a few hundred stars, dozens of issues and a dozen substantive
emails. More valuable than the traffic: the thread tells you exactly how
developers misunderstand the product, which is your next positioning fix.

**Normal submissions:** your blog posts can be submitted (by you, honestly,
occasionally) if they stand alone as interesting. A post that is a product
pitch dies; a post about something you learned building the product, with
the product mentioned once, can do well.

## 6. Reddit by subreddit type

Reddit is many communities with different norms, and the fastest way to be
banned is to treat it as one channel. Read the rules of each subreddit and
the last week of top posts before posting. Roughly:

**Technical subreddits** (r/programming, r/webdev, r/rust, r/golang,
r/node, r/typescript, r/PostgreSQL, r/devops, r/selfhosted). Norms: show
the code or the technical insight; "I built X" posts are tolerated when
the post teaches something or the project is open source; pure promotion
is removed. Best format: a post explaining a technical decision or a
problem solved, with the project linked once. r/selfhosted and r/rust are
friendly to open source launches that follow their flair rules;
r/programming is harsh on anything that smells like marketing. Many ban
link posts to your own domain unless you participate otherwise; comment
genuinely for weeks first.

**Founder and startup subreddits** (r/SaaS, r/startups, r/Entrepreneur,
r/indiehackers, r/SideProject). Norms: launch posts are welcome if they
share real numbers and lessons; "I made $X in Y months, here's how" is the
native format. Audience is other founders, not your customers, unless you
sell to founders. Good for feedback and for finding newsletter writers.

**Niche professional subreddits** (r/accounting, r/freelance,
r/smallbusiness, r/Journalism, r/therapists). Norms: strictly no
self-promotion in most; often a weekly thread for tools; moderators are
quick. The way in: answer questions in the subreddit for weeks, mention the
product only when directly relevant and disclosed ("I built a tool for
this, disclosure"). A single well-received comment in the right thread can
be worth more than a launch post.

**Consumer and hobby subreddits** (r/productivity, r/ios, r/androidapps,
r/apple). Norms: app launches are common; "I built an app that..." with a
promo code gets traction in r/androidapps and r/iosapps; r/apple and r/ios
remove most promotion. Give away something (free codes, lifetime for
first 50) and ask for feedback.

Universal Reddit rules: use your real account with history, not a fresh
one; disclose that it is your product; reply to every comment; do not
cross-post the same text to five subreddits in an hour (it is detected
and reads as spam); do not ask friends to upvote (vote manipulation is a
sitewide ban). Reddit posts live for a day and then rank in Google for
years, so the title should contain the words someone would search.

## 7. X, Bluesky, LinkedIn threads

The launch thread is a long post broken into parts, each of which must
earn the next. Platform norms differ; see `social-and-community.md` for the
ongoing presence; this is the launch-day post.

**X / Bluesky launch thread**

Structure that works (8-12 posts):
1. The one-liner plus the demo video or GIF. This post must stand alone;
   most readers see only it.
2. The problem, in one specific story (the column rename, the chased
   invoice).
3. What it does, concretely.
4-7. One capability per post, each with a screenshot or short clip. Show,
   not tell.
8. What it does not do / who it is not for.
9. The stack or an interesting technical detail (developer audiences
   like this).
10. How to try it, with the direct link. Pricing if any, plainly.
11. Ask: "If you try it, tell me what broke." Not "RT to spread the word".

Mechanics: media in every post; the link in the last post and the first
reply (the algorithms de-rank external links in the first post on X,
less so on Bluesky); post at the ICP's working hours; pin it; reply to
every quote and comment for two days. Hashtags are not read on X in 2026;
on Bluesky feeds and starter packs matter more than hashtags.

**LinkedIn launch post**

Different audience (buyers, not builders, for most B2B) and different
format: a single long post, not a thread. Structure: a first line that
states the specific problem (the first line is all that shows before
"see more"), two or three short paragraphs of story and what the product
does, a plain ask, the link in the first comment (LinkedIn also de-ranks
posts with external links). Native video or a carousel PDF outperforms a
link preview. No hashtag block. Tag only people who actually helped.

Avoid the LinkedIn clichés: one-sentence paragraphs with line breaks
between every sentence, "I'm humbled to announce", the fake-vulnerability
story. The register that works for a small team is plain: here is what we
built, here is why, here is who it is for.

**Founder account versus company account:** launch from the founder's
account. Company accounts get a fraction of the reach on every platform
and nobody follows them.

## 8. Newsletter and community outreach

The most reliable launch channel for a niche product is the handful of
newsletters and communities the ICP already reads. For a TypeScript tool:
the TypeScript Weekly, Node Weekly, Bytes, JavaScript Weekly, This Week in
React, plus the TypeScript Discord and the Prisma community (yes, the
alternative's community, carefully). For services-firm software: the
accounting and freelance newsletters and Facebook groups. For a consumer
app: the productivity newsletters and the relevant YouTube reviewers.

Find them: search "[topic] newsletter", "[topic] weekly"; check what your
alpha users read; look at what links appear in the HN threads of similar
products.

Outreach email, two weeks before launch:

```
Subject: pgtypes – types from a live Postgres schema (launching Oct 21)

Hi Peter,

I read [Newsletter] every week; the issue on migration tooling in
August is how I found Atlas.

I'm launching pgtypes on Oct 21: it generates TypeScript types from a
live Postgres schema (or a migrations folder), no ORM, single binary,
runs in CI in under a second. Repo: [link]. It's MIT.

If it's a fit for an issue, here's a one-paragraph description and a
60-second demo: [link]. Happy to answer anything or write a short
piece on how we handle Postgres enums and ranges if that's more useful.

No worries if not.

Ana
```

Rules: one personal line that proves you read it; the one-liner; the
exact date; a link; an offer of something useful (a guest piece, a demo,
early access for their readers); no attachment; no follow-up more than
once. Many newsletters take submissions via a form; use it. Some have paid
sponsorship ($200-$2,000 for small niche newsletters); it is often the
best-priced paid channel available to a small team once you know the
organic post converts.

Communities (Discords, Slacks, forums): participate for weeks first. On
launch day, post in the channel meant for it (#showcase, #show-and-tell)
with the plain description and a question. Never DM members.

## 9. Press for small teams

Mainstream tech press rarely covers a two-person launch, and when it does
the traffic converts poorly. Worth the time: niche trade press (the
accounting trade publications, the developer-focused blogs), YouTube and
podcast creators in the niche (a 20-minute walk-through on a channel with
20,000 subscribers beats a TechCrunch mention for a developer tool), and
the writers who cover your category on Substack.

Pitch format: subject line is the one-liner; first sentence is why this
is relevant to their audience specifically; second paragraph is what it
is and the one surprising thing; offer an interview, a demo, exclusive
numbers or an early look; link to a press kit (logo, screenshots, founder
photos and bios, the one-liner and expanded one-liner, a fact sheet) on a
`/press` page. Three paragraphs maximum.

Give exclusives selectively: one outlet gets the story a day early in
exchange for coverage on launch day. Honour it.

Do not pay for "guaranteed placement" press releases; the wires are not
read by humans and the backlinks are worthless.

## 10. Launch day checklist

The night before:
- Install path tested on a clean machine or VM for each platform you claim
- Signup, payment and welcome email tested end to end
- Site loads in under 2 seconds on mobile; images compressed (design's
  budgets in `design/references/landing-pages.md`)
- Analytics events firing: visit by referrer, CTA click, signup, first
  action (see `analytics-and-growth.md`)
- Status page or a prepared "we're having trouble" post
- Rate limits and quotas raised on anything that will spike (email
  provider, auth provider, DB connections)
- Error tracking on, alerts to your phone
- All posts drafted in a doc, with media attached, links checked
- The list (section 3) with messages drafted per person
- Cofounder or friend lined up for a second shift
- Repo README matches the landing page (same one-liner)
- `/press` page live if press is in the plan
- Calendar cleared for 24 hours

Day of:
- Post in channel order (PH 12:01am PT if applicable; HN morning ET; X/LI
  at ICP working hours; newsletters already sent)
- Message the list, personally, when each post is live
- Reply to every comment, everywhere, within the hour, for 12+ hours
- Fix bugs live and say so in the thread
- Log every piece of feedback in one place (issues, a doc)
- Note what people misunderstood; this is tomorrow's copy fix
- Thank people by name, publicly, who gave real feedback
- Do not check the ranking every five minutes; set a timer for hourly

## 11. Post-launch follow-through

The week after decides whether the launch compounds or evaporates.

- Day 1-3: ship fixes for everything reported; post a "what we fixed from
  launch feedback" update in the same threads. This turns critics into
  watchers.
- Day 3: email everyone who signed up but did not activate with the one
  thing to do (see `email.md`, activation nudge).
- Day 7: write the retrospective. Numbers (section 12), what people
  misunderstood, the quotes you may use (ask permission now while they are
  warm), what you would do differently. Publish it if the numbers are
  interesting; "we launched on HN and here's what happened" posts do well
  and are a second launch.
- Day 7-14: reach out to the five most engaged users for a 20-minute call.
  Ask what they were using before, what almost stopped them, what they
  would tell a colleague.
- Day 14: update positioning and copy with what you learned. The launch
  thread tells you the real alternative and the real objection.
- Day 30: plan the second launch. A feature, a platform, a v1, an
  integration. Smaller, but with the proof the first one generated.

## 12. Measuring a launch

Define success before launch day in terms you can measure the week after.
A reasonable set for a developer tool:

| Metric | Why | Where |
|---|---|---|
| Visits by referrer | Which channel actually sent people | Analytics, UTM on your own links |
| Visit to signup/install rate by referrer | Which channel sent the right people | Analytics funnel |
| Activation rate (did the first real action) | Did the product work for strangers | Product events |
| Stars, forks, issues opened | Developer interest and engagement | GitHub |
| Substantive comments and their themes | What people misunderstood | Manual log |
| Signups to the list for the next launch | Compounding | Email tool |
| Quotes obtained with permission | Proof for the next page | Doc |
| Retention at day 7 | Whether anyone stayed | Product events |

Vanity metrics to record but not optimize: upvotes, likes, impressions,
ranking. They correlate with visits and nothing else.

Compare channels on visit-to-activation, not on visits. HN often sends 10x
the traffic of a niche newsletter and converts at a fifth the rate; the
newsletter audience was pre-qualified.

Give the launch two weeks before judging it. Search traffic from the
Reddit and HN threads arrives for months.

## 13. Failure modes

- **Launching to no list.** "Post it and see" yields a few hundred visits
  and silence. Build the list first; it is most of the work.
- **Assuming a big audience.** Plans that say "go viral on X" or "get on
  the PH homepage" as a step. Plan for the median and be pleased by the
  tail.
- **Marketing register on HN.** The title gets rewritten or flagged, and
  the thread is about the marketing instead of the product.
- **Asking for upvotes.** Detected, penalized, and remembered.
- **Not being present.** A launch thread with unanswered questions reads as
  an abandoned product.
- **Gating the product behind a form on launch day.** Developers bounce; HN
  comments say so; the thread dies.
- **Launching everything on one day and never again.** The second and
  third launches are cheaper and convert better.
- **Judging by upvotes.** A #1 PH day with no activations is a failed
  launch; a #40 with twenty active teams is a success.
- **Cross-posting identical text everywhere.** Each platform has a register;
  the identical text reads as spam on all of them.
- **Skipping the retrospective.** The thread contains your next
  positioning; read it.
