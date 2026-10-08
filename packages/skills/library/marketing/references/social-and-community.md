# Social and community

Platform presence and community for a small software team: the native
format and current norms of each platform, a cadence that can be sustained
by people whose job is building the product, a repurposing pipeline so one
idea feeds every channel, founder-led content, the stages of community
building, and how to handle criticism in public. Launch-day posts are in
`launch.md`; developer-specific community mechanics (Discord, GitHub
Discussions) are in `developer-marketing.md`.

## Contents

1. What social is for, and what it is not
2. Choosing platforms: where the ICP actually is
3. Platform by platform
4. Cadence that survives
5. The repurposing pipeline
6. Founder-led content
7. Formats that work for small software teams
8. Community building stages
9. Handling criticism in public
10. Metrics that mean something
11. Failure modes

## 1. What social is for, and what it is not

For a small software team, social media does four things, in descending
order of value: it lets the founders be findable and credible to the people
who matter (the ICP, potential hires, partners, press); it distributes the
things you make (posts, releases, launches) to a list you own in a weak
form; it generates feedback and conversation faster than any other channel;
and occasionally it brings customers directly. It is not, for most B2B and
developer products, a primary acquisition channel; attribution studies
consistently show social as an assist, not a closer. Plan for it as a
reputation and distribution layer, and be pleased when it sells.

The thing that works is a person, not a brand. A founder account with 800
followers in the right niche outperforms a company account with 8,000
general ones on every metric that matters. Company accounts exist to be
tagged and to look alive; the founder account is the channel.

## 2. Choosing platforms: where the ICP actually is

Pick one primary platform, one secondary, and ignore the rest until the
primary is working. The choice follows the audience:

| ICP | Primary | Secondary | Notes |
|---|---|---|---|
| Developers (web, backend, OSS) | X or Bluesky (community has split; check where your specific niche went) | Reddit (language/tool subs), Hacker News | Mastodon for some infra/OSS niches; LinkedIn weak |
| Developers (enterprise, platform, security) | LinkedIn | X | Decision-makers are on LinkedIn even when practitioners are not |
| Designers, product people | X, LinkedIn | Threads, Bluesky | Dribbble/Behance for visual work |
| B2B buyers (ops, finance, sales, marketing) | LinkedIn | X, niche communities (Slack groups, Facebook groups) | Industry-specific forums matter more than general social |
| Small business owners, freelancers | LinkedIn, Facebook groups | Instagram, TikTok (visual trades) | Facebook groups are where many actually are |
| Consumers (productivity, lifestyle) | TikTok, Instagram, YouTube Shorts | Reddit, X | Short video is the format; a product that can be shown in 15 seconds has an advantage |
| Founders, indie hackers | X, Indie Hackers, r/SaaS | LinkedIn | Only if you sell to founders |

Confirm by looking: where do your alpha users post? Where do the
newsletters in your niche get shared? Where did your competitors' launch
threads happen? Where do people complain about the alternative?

## 3. Platform by platform

Norms shift yearly; these are the durable mechanics as of late 2026, and the
agent should check the platform's current state when something feels off.

### X

Native formats: single posts with an image or short video; threads (8-12
posts) for depth; quote posts to add a take; long-form posts for
subscribers. External links in the first post are de-ranked; put the link
in a reply or the last post of a thread. Hashtags are dead. Replies to
larger accounts in your niche with substantive takes are the main growth
mechanic for small accounts. Developer audience is still here but thinner
than 2022; the algorithm rewards controversy, which is a problem for
measured technical content. Post when the ICP is working (weekday mornings
in their zone).

### Bluesky

Where part of the developer and design community moved. Mechanics: no
algorithmic penalty for links; custom feeds and starter packs matter more
than hashtags (get added to the relevant starter packs); smaller but
denser audiences in some niches (web standards, OSS, accessibility,
infosec). Conversation quality is higher; reach ceilings are lower. Cross-
post X content here only after adapting (no "RT", no X-isms).

### LinkedIn

Native formats: text posts (first line is all that shows before "see
more"; it must stand alone); document carousels (PDF slides) which get the
most reach; native video; polls (cheap engagement, low value). External
links de-ranked; link in the first comment. The register that works is
plain, specific and first-person: a lesson, a number, a story with a point.
The register that is parodied: one-sentence paragraphs, "I'm humbled to
announce", fake vulnerability. Comments on others' posts in the first hour
drive visibility. B2B buyers read; practitioners mostly do not. Post weekday
mornings; weekends are dead.

### Reddit

Not a broadcast channel. Each subreddit is a community with rules; read
them and the top posts for the week before posting. Self-promotion is
allowed in some (r/SideProject, r/selfhosted with flair), tolerated with a
10:1 ratio of participation in others, banned in many. The format that
works is a genuinely useful post (a technical explanation, a lesson with
numbers) with the product mentioned once and disclosed. Comments are where
most value is; being the person who answers questions well in r/[your
niche] is slow, real marketing. Threads rank in Google for years; titles
should be searchable. See `launch.md` for subreddit types.

### Hacker News

Not social, but adjacent. You cannot build a presence; you can submit good
things occasionally and comment well. See `launch.md`.

### Threads

Instagram-adjacent; lighter, consumer and creator audiences; link-friendly.
Reach is unpredictable. Worth a presence for consumer products; low value
for B2B and developer tools.

### Mastodon / Fediverse

Specific technical communities (infra, FOSS, privacy, some academic
fields) live here. No algorithm; reach is followers and boosts. Links are
fine. Register is anti-marketing; post as a person about the work.

### YouTube

The search engine for "how to" and the platform with the longest content
half-life. A 10-minute walkthrough of the product ranks for years. Shorts
feed discovery. Production bar is lower than people think: screen
recording, clear audio, a plan, and no intro longer than five seconds. For
developer tools, a "building X with Y in 15 minutes" video is some of the
best acquisition content available. Thumbnail and title carry 80% of
click-through.

### TikTok / Instagram Reels / YouTube Shorts

Short vertical video. Consumer products that can be shown in 15-30 seconds
can grow here; some B2B and developer content works ("dev tips", "day in
the life", code explained) but conversion to a B2B product is weak. The
hook is the first second; text on screen; show the thing.

### Discord / Slack communities (others')

Where many niches actually talk. Join the three communities your ICP is in;
participate for weeks; post in #showcase when allowed; never DM members
about your product.

### Dev.to, Hashnode, Medium

Syndication platforms for technical posts. Publish on your own domain
first, syndicate with the canonical URL set to yours, and add the
platform's native touches (tags, a short intro). They bring some
discovery and backlinks, less than they did.

### Product directories (G2, Capterra, AlternativeTo, Product Hunt, the
app stores, package registries)

Not social, but part of presence. Claim the listing; make the description
the one-liner; add real screenshots; ask real users for reviews (with the
disclosure rules in `claims-and-compliance.md`). Reviews on G2 and
Capterra influence B2B buyers more than any post.

## 4. Cadence that survives

The cadence that works is the one you keep for a year. Posting daily for
three weeks and then nothing for two months is worse than weekly for a
year; the algorithms reward consistency and the audience forgets you.

A sustainable baseline for a two-to-five person team where nobody is
full-time on marketing:

| Channel | Cadence | Time cost |
|---|---|---|
| Primary platform (founder account) | 3-5 posts a week, mostly short; one substantive (thread, carousel, long post) a week | 30-45 min a day including replying |
| Secondary platform | 1-2 posts a week, adapted from the primary | 15 min a week |
| Replying and commenting in the niche | Daily, 15 minutes | Most of the growth comes from here |
| Long-form (blog, video) | 1-2 a month | Half a day each |
| Newsletter / changelog email | Monthly | 2 hours |
| Community (own Discord or Discussions) | Daily presence, short | 15-30 min a day |

Batch creation: write the week's posts in one 90-minute session (Monday),
schedule them, then spend daily time only on replies and reactive posts.
Tools that schedule across platforms (Buffer, Typefully, Hypefury,
Publer) are worth the small fee; posting natively one at a time is the
thing that kills cadence.

What to post when there is "nothing to say": what you shipped this week
(there is always something); a problem you solved and how; a question you
are deciding; a number (users, stars, a benchmark); a reply to someone
else's post turned into a post; a screenshot of the product doing the
thing; a user's message (with permission); something you learned; what
you are reading in the niche.

Say "no" to platforms, not to cadence. Two platforms done consistently beat
six done sporadically.

## 5. The repurposing pipeline

One substantial idea a week feeds every channel. The pipeline:

```
Source (one per week)
  A blog post, a changelog, a customer call, a bug fixed, a talk, a
  user question answered well, a decision made

  └─ Long form (1)
       Blog post or video, 800-2,000 words / 8-15 min

       ├─ Thread or carousel (1)
       │    The post's structure as 8-12 beats, each with an image
       │
       ├─ Short posts (3-5)
       │    Each beat that stands alone becomes a single post over the
       │    following week; different angles, not the same sentence
       │
       ├─ Newsletter item (1)
       │    Two paragraphs and the link, in the monthly send
       │
       ├─ Community post (1)
       │    Shared in own Discord/Discussions and, if it teaches,
       │    the relevant subreddit or external community
       │
       ├─ Short video (optional, 1)
       │    60-second screen recording of the key moment
       │
       └─ Docs or FAQ update (often)
            If the idea answered a question, the answer goes in the docs
            where search will find it
```

Rules: each derivative is rewritten for the platform's register, not
pasted; derivatives are spread over one to three weeks, not posted the
same day; the long form lives on your domain so every derivative links to
something you own; track which derivatives earn the most engagement and
make more of that format.

## 6. Founder-led content

The founder's account is the channel because people follow people, the
founder has the knowledge, and the authenticity cannot be delegated. What
works:

**The building log.** What you shipped, what broke, what you learned, with
numbers. "Week 14: 212 stars, first paying team, and the Windows bug that
took three days." Readers follow a story; this is one.

**Opinions with evidence.** You have views about your category formed by
building in it. "Most teams don't need an ORM; here's the data from 40
schemas." Opinions get shared and argued with; evidence makes them land.
Pick fights about ideas, not people or companies.

**Teaching from the work.** The technical explanation you had to figure
out, written for the person a year behind you. The highest-value, most
evergreen format.

**Behind the decision.** "We considered three pricing models. Here's why we
chose per-seat and what we're worried about." Transparency reads as
confidence and recruits advocates.

**Numbers.** Revenue, users, conversion rates, costs. Build-in-public
numbers get disproportionate engagement and establish credibility fast.
Decide the boundary deliberately (some teams share everything; some share
growth rates but not absolutes) and keep it consistent.

**Replies.** Half of founder-led growth is substantive replies to larger
accounts in the niche. A reply that adds a genuine insight to a popular
post is seen by that post's audience; done daily, this is how a small
account gets found.

What does not work: motivational platitudes, engagement-bait questions
("What's your favourite programming language?"), hustle narratives, posting
about posting, screenshots of your own analytics with no lesson, and
anything that reads as written by a ghostwriter.

Voice: the founder's actual voice, which will be rougher than marketing
copy, and should be. The agent drafting for a founder should match how
they actually talk (read their existing posts) and leave the edges on.
Over-polished founder content is detectable and discounted.

Two-founder teams: both post, with different angles (technical and
product, or product and business). Cross-amplify sparingly; it looks
staged when every post is quoted by the cofounder within a minute.

## 7. Formats that work for small software teams

Beyond the founder formats above, by platform:

- **The before/after screenshot.** The problem state and the solved state,
  side by side. Works on every platform; needs no words.
- **The 20-second screen recording.** The product doing the one thing, no
  narration or a single caption. The most shareable developer format.
- **The "we were wrong" post.** A decision reversed, honestly. Engagement
  and trust.
- **The user's result, quoted.** With permission, their words, their
  number. Social proof that does not sound like you.
- **The one-liner plus code block.** For developer tools on X/Bluesky: the
  claim, then six lines that prove it.
- **The comparison table image.** Honest, dated, fits a single image.
  Travels well; check `claims-and-compliance.md`.
- **The changelog summary.** "This month in X" as a carousel or thread.
  Sustainable because the content exists.
- **The poll with a point.** Ask the question you are actually deciding;
  post the result and the decision.
- **The AMA or office hours announcement.** Low effort, builds community.
- **The talk recording clip.** 60-90 seconds from a conference or meetup
  talk, captioned.

## 8. Community building stages

Community here means the people who use the product and talk to each other
about it, wherever that happens. Mechanics for Discord and GitHub
Discussions are in `developer-marketing.md`; this is the strategic layer.

**Stage 0: there is no community, there are users.** Do not create a
Discord. Talk to users one at a time (calls, replies, email). Collect what
they say. Introduce users to each other when it is useful ("Tom is also
running this on RDS; mind if I connect you?").

**Stage 1: the first room (20-100 people).** Start the space when support
questions repeat and users would help each other. The founders are present
daily and answer within the hour. Greet every new member by name. Seed
conversation with real questions ("How are people handling X?"). It will
feel like a group chat with the founders at the centre. That is correct.

**Stage 2: regulars (100-1,000).** A few people answer others' questions
before you do. Recognize them publicly; give them a role; involve them in
decisions (early access, roadmap input). Start a rhythm: a weekly thread,
monthly office hours, a showcase channel where members' work is celebrated.
Document the recurring answers into docs. Write a code of conduct and
enforce it visibly the first time it matters.

**Stage 3: self-sustaining (1,000+).** Moderators from the regulars;
contributor paths; community-created content (plugins, templates,
tutorials) that you amplify; meetups or a yearly online event. The
founders' job shifts from answering to listening and celebrating. A
community manager becomes a real hire somewhere in this stage.

Principles across stages: the community belongs to its members, not to
marketing; never DM members with sales messages; announcements are rare and
substantive; criticism inside the community is answered, not removed;
members' work gets more spotlight than the company's; the founders are
reachable.

Communities fail by being created too early (empty rooms), by being treated
as a lead list, by going quiet from the company side, and by tolerating a
toxic regular because they are active.

## 9. Handling criticism in public

Criticism is content. How you respond is read by many more people than the
critic, and a good response converts bystanders.

**Fair criticism (a bug, a limitation, a bad experience):**
1. Respond fast (within hours), publicly, in the thread.
2. Acknowledge the specific thing without defensiveness: "You're right,
   the Windows install is broken on 0.4.0."
3. Say what you are doing and when: "Fix is in #231; release tonight."
4. Follow up in the same thread when done: "Fixed in 0.4.1. Thank you for
   the repro."
5. If they were right about something you disagreed with at first, say so.

**Unfair or mistaken criticism:**
1. Respond once, politely, with the fact and a link: "pgtypes doesn't
   send telemetry; here's the network-call list in the docs."
2. Do not argue past the first reply. Bystanders have seen the fact; the
   critic's second reply is for them to make.
3. Never mock, never pile on, never let the community pile on (ask them to
   stop if they start).

**Hostile criticism (bad faith, personal, harassing):**
1. One factual reply if there is a fact to state, or none.
2. Mute, block or report as appropriate. Do not screenshot and quote-post
   it for sympathy; it amplifies the hostility and reads as thin skin.

**Competitor criticism (a competitor or their fans attacking):**
1. Respond to facts with facts; do not name-call the competitor.
2. If they are right about a gap, say so and say whether you plan to close
   it.

**Public incidents (outage, data issue, a bad release):**
1. Acknowledge within minutes on the status page and the primary social
   channel, even before you know the cause: "We're seeing elevated errors
   on generate; investigating."
2. Update every 30-60 minutes until resolved, even if the update is "still
   working on it."
3. Post the postmortem within a week: what happened, why, what changed.
   Specific, blameless, no spin. Postmortems are among the most shared and
   trusted content a small company can publish.

What never works: deleting critical comments (they screenshot first),
responding with marketing language, having the cofounder respond "as a
user", silence.

## 10. Metrics that mean something

Followers, likes and impressions are inputs, not outcomes. Track:

- **Profile to site clicks** and what those visitors do (signup rate). The
  only direct conversion measure.
- **Replies and DMs from the ICP.** A substantive reply from a target user
  is worth more than a thousand impressions from nobody.
- **Mentions by others** (unprompted). The signal that word of mouth is
  happening.
- **Signups and activations attributed to social** (UTMs on your own links;
  "how did you hear about us" in onboarding, which catches the dark social
  that UTMs miss).
- **Growth of the right followers**: when a new follower appears, are they
  the ICP? Check a sample monthly.
- **Content half-life**: which posts still get engagement a week later.
  Make more of those.

Review monthly; adjust quarterly. Do not change platform strategy based on
one post's performance in either direction.

## 11. Failure modes

- **Company account as the primary channel.** Nobody follows a logo.
- **Six platforms, none consistently.** Pick two.
- **Daily for three weeks, then silence.** Set the cadence you can hold
  for a year.
- **Cross-posting identical text.** Each platform has a register; identical
  text reads as automated on all of them.
- **Engagement bait.** "Agree?" "Thoughts?" "What's your favourite X?"
  Attracts the wrong audience and reads as desperate.
- **Ghostwritten founder voice.** Polished, generic, detectable.
- **Treating communities as lead lists.** DMs, pitches in #general, scraping
  members. Banned and remembered.
- **Creating the Discord at ten users.** Visible emptiness.
- **Arguing with critics past the first reply.** Nobody wins; bystanders
  leave.
- **Deleting criticism.** It was screenshotted.
- **Measuring followers.** The number that matters is ICP signups.
- **Buying followers or engagement.** Destroys the account's reach
  permanently and is visible to anyone who checks.
- **Posting only product announcements.** A feed of release notes is a
  changelog, not a presence; people follow people with ideas.
