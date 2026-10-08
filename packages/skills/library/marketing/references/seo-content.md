# SEO content

Search content strategy for a small software team: intent-first keyword
research with and without paid tools, topic clusters, a content brief
template, the on-page checklist, internal linking, when programmatic SEO is
legitimate and when it is spam, the comparison and alternatives page
playbook, the technical SEO handoff list for `frontend`, E-E-A-T, AI
overviews and answer engines, the Google Search Console workflow, and when
and how to refresh content.

## Contents

1. What SEO is for a small software product
2. Intent first: the four kinds of query
3. Keyword research without paid tools
4. Keyword research with tools
5. Topic clusters
6. The content brief template
7. On-page checklist
8. Internal linking
9. Programmatic SEO: legitimate and spam
10. Comparison and alternatives pages
11. Technical SEO handoff to frontend
12. E-E-A-T for a small team
13. AI overviews and answer engines
14. Measuring: the Search Console workflow
15. Refresh strategy
16. Failure modes

## 1. What SEO is for a small software product

Search brings people who already have the problem, at the moment they are
looking for a solution. That intent makes search traffic convert at
several times the rate of social or launch traffic, and it compounds: a
page that ranks keeps working for years. The costs: it is slow (three to
nine months before new pages rank for anything competitive), it rewards
consistency over bursts, and it has become harder as AI-generated content
floods every query and AI overviews absorb informational clicks.

The strategy that still works for a small team: own the queries that are
specific to your category and alternatives (low volume, very high intent),
write the few deep pieces that only someone who built the thing could
write, make the docs and examples rank for the "how to" queries, and skip
the broad informational terms that giants and content farms fight over.

Volume is a trap. "project management" has a million searches and converts
no one; "self-hosted jira alternative" has a few hundred and converts a
tenth of them. Rank the second.

## 2. Intent first: the four kinds of query

Every query has an intent, and the page that ranks is the one that
satisfies it. Classify before writing:

| Intent | Example | What ranks | What it is worth to you |
|---|---|---|---|
| Informational | "what is schema drift" | Explanations, guides | Low direct conversion; builds topical authority and E-E-A-T; increasingly absorbed by AI overviews |
| Navigational | "pgtypes docs" | Your own pages | Must rank; if you do not, something is broken |
| Commercial investigation | "prisma alternatives", "pgtypes vs prisma", "best postgres type generator" | Comparison pages, listicles, reviews | High; the reader is choosing |
| Transactional | "pgtypes pricing", "install pgtypes", "buy X" | Pricing, docs, signup | Highest; the reader has chosen |

The second two are where a small product's SEO effort goes. The
informational intent is served by docs and the few deep posts you would
write anyway; chase it only where you have genuine expertise and the
query relates to your category.

Read the SERP to confirm intent: search the term and look at what ranks.
If the first page is all listicles, the intent is commercial; a tutorial
will not rank there regardless of quality. If it is all docs pages, write
docs. If it is Reddit threads and forum posts, the searcher wants
experience, and a first-person post can win.

## 3. Keyword research without paid tools

A small team can do most of the work with free sources:

**Google itself.** Type the seed term and read autocomplete; append each
letter of the alphabet. Scroll to "People also ask" and "Related
searches". Search the term in quotes to see how many pages compete. Use
`site:reddit.com [term]` to find the questions people actually ask and the
words they use.

**Google Search Console** (if the site exists): the Performance report lists
every query that already shows your pages, with impressions and position.
Queries at position 8-20 with impressions are the cheapest wins: the page
exists and is almost there.

**Your own data.** Support tickets, sales calls, Discord questions, GitHub
issues: the questions people ask you are the questions they ask Google
first. Mine them for exact phrasing.

**Competitor sites.** Read their docs navigation, blog titles, comparison
pages and sitemap (`/sitemap.xml`). What they rank for, you can compete
for.

**Community sites.** Reddit, Stack Overflow, HN, Dev.to, the language
forums: search the topic and sort by top; the titles are queries.

**Free tool tiers.** Google Keyword Planner (needs an Ads account; gives
ranges), Ahrefs' free keyword generator (limited results), AlsoAsked
(question clusters), AnswerThePublic (limited free searches), Keywords
Everywhere (cheap credits). Each gives rough volume; treat all volume
numbers as order-of-magnitude.

Record each candidate with: the query, estimated volume (or "unknown, but
asked in support 4 times"), intent class, what currently ranks, your
honest chance of ranking (do you have a page that could be the best
result?), and the business value (does this searcher become a user?).

## 4. Keyword research with tools

Ahrefs, Semrush, Moz and similar ($100-$400/month) add: volume and
difficulty estimates, the full keyword list a competitor ranks for, backlink
profiles, and SERP history. Worth paying for a month when you are planning
a quarter of content; rarely worth a permanent subscription for a small
team.

The workflow with a tool:
1. Enter two or three competitors' domains; export their organic keywords.
2. Filter to keywords with commercial or transactional intent (modifier
   words: alternative, vs, pricing, best, review, tool, software,
   integration, "for [stack]").
3. Filter to difficulty you can plausibly beat (for a new domain, keyword
   difficulty under 20-30 on most tools' scales).
4. Look for clusters (section 5) rather than individual terms.
5. Check the SERP manually for each shortlisted term; tools misjudge intent.
6. Prioritize by value times likelihood, not by volume.

Content gap analysis (keywords competitors rank for and you do not) is the
single most useful tool feature for a small team.

## 5. Topic clusters

Search engines rank sites that cover a topic thoroughly over sites with
one isolated page. A cluster is one pillar page covering the topic broadly,
linked to and from a set of specific pages covering sub-topics.

For a Postgres type generator:

```
Pillar: TypeScript and Postgres: getting end-to-end type safety
  (3,000 words; the complete guide; links to everything below)

  Cluster pages:
  - Generating TypeScript types from a Postgres schema (how-to)
  - Postgres enums in TypeScript: three approaches
  - Handling jsonb columns with typed TypeScript
  - Prisma vs Kysely vs raw SQL for TypeScript (comparison)
  - Keeping types in sync with migrations in CI
  - Migrating from Prisma to raw SQL with generated types
  - pgtypes vs Prisma (vs page)
  - Prisma alternatives for TypeScript (alternatives page)
  - Supabase + TypeScript types without the Supabase CLI (integration)
```

Each cluster page targets one query cluster, links up to the pillar and
sideways to two or three siblings. The pillar links down to all. The
product's docs link in where relevant.

Choose clusters where you have real expertise and the product is a natural
answer. One well-built cluster beats twenty scattered posts. A small team
can build one or two clusters a quarter.

## 6. The content brief template

Write a brief before each piece. It prevents the two SEO failures: a piece
that targets no query and a piece that targets a query without satisfying
it.

```
TITLE (working):   Postgres enums in TypeScript: three approaches and
                   their failure modes
PRIMARY QUERY:     postgres enum typescript   (est. 400/mo, informational
                   with commercial edge; SERP: 2 docs pages, 3 blog posts,
                   1 Stack Overflow, 1 Reddit)
SECONDARY QUERIES: typescript enum from postgres, pg enum type generation,
                   prisma enum postgres
SEARCHER:          TS backend dev who hit an enum mismatch; wants a working
                   approach today; will accept a tool if it is the honest
                   answer
INTENT TO SATISFY: compare the approaches; give working code for each; say
                   which to use when
WHAT RANKS NOW AND ITS GAP:
                   Top results explain Prisma's enum mapping only; none
                   cover string-literal unions vs TS enums vs branded
                   types; none show the CI drift problem
ANGLE / WHY US:    We generate these for a living and have seen the failure
                   modes across 40+ schemas; we can show real cases
OUTLINE:
  H1  Postgres enums in TypeScript: three approaches
  Intro (80 words): the problem in one sentence; the three approaches
       named; which we recommend and why, upfront
  H2  How Postgres stores enums (and why ALTER TYPE matters) (200 words)
  H2  Approach 1: TypeScript enum (code, pros, the two failure modes)
  H2  Approach 2: string literal union (code, pros, failure mode)
  H2  Approach 3: generated from the schema (code; mention pgtypes and
      Kysely codegen; honest about when it is overkill)
  H2  The drift problem: when someone adds a value in production
  H2  Which to use (a short table)
  FAQ (3 questions from People Also Ask, 50 words each)
LENGTH:            1,600-2,200 words; length is driven by the three code
                   samples, not padding
PROOF / ASSETS:    runnable repo for all three approaches; screenshot of
                   the CI failure
INTERNAL LINKS:    up to pillar; sideways to "jsonb columns" and
                   "keeping types in sync in CI"; docs link for enum
                   handling
CTA:               one, at the end: "If you want approach 3 without
                   writing the generator, pgtypes does it" + docs link
META TITLE (≤60):  Postgres Enums in TypeScript: 3 Approaches Compared
META DESC (≤155):  TS enum, string union, or generated from schema? Working
                   code for each, the failure modes, and how to stop enum
                   drift in CI.
AUTHOR:            named, with bio and link (E-E-A-T)
```

## 7. On-page checklist

For every page meant to rank:

- One H1 containing the primary query or its natural equivalent
- The first 100 words answer the query directly; no "in this article we
  will"
- H2s cover the sub-questions a searcher has, in natural language, not
  keyword-stuffed ("How Postgres stores enums", not "Postgres enum
  TypeScript storage")
- Primary query appears in the title tag, H1, first paragraph, and
  naturally a few more times; secondary queries appear where natural;
  no density targets, which are a 2010 artifact
- Title tag under 60 characters, specific, with the query near the front
- Meta description under 155 characters, written as the snippet you want,
  with a reason to click; it does not affect ranking but affects
  click-through
- URL short, lowercase, hyphenated, containing the query: `/blog/postgres-
  enums-typescript`, not `/blog/2026/10/08/post-id-4821`
- Images have descriptive `alt` text and descriptive filenames; compressed
- Code blocks are real and complete
- At least three internal links out, in context, with descriptive anchor
  text; at least two internal links in from existing pages
- One or two external links to authoritative sources (the Postgres docs,
  the TypeScript handbook); linking out is not a leak
- Author name and bio with a link; published and updated dates visible
- Table of contents for pages over 1,500 words (helps users and generates
  sitelinks)
- FAQ section only if the questions are real; marked up with FAQ schema
  only where Google still shows it (it has restricted FAQ rich results
  to authoritative sites)
- Readable on mobile; no interstitials; loads under 2.5s LCP (frontend's
  budget)
- Canonical tag points to itself (or to the original if syndicated)

## 8. Internal linking

Internal links tell search engines which pages matter and tell readers
where to go next. Rules:

- Every new page gets linked from at least two existing pages within a
  week of publishing, with anchor text that describes the destination
  ("how to handle Postgres enums in TypeScript", not "click here" or
  "this post").
- The pillar page links to every cluster page; every cluster page links to
  the pillar.
- The pages you most want to rank (comparison, alternatives, pricing, the
  pillar) get links from the navigation, footer or sidebar, so they are
  reachable from everywhere.
- Docs link to relevant blog posts and vice versa; the two are one site to
  a crawler.
- Audit quarterly for orphan pages (no inbound internal links) and fix.
- Do not link the same anchor text to two different pages; it confuses
  which page targets which query.

## 9. Programmatic SEO: legitimate and spam

Programmatic SEO generates many pages from a template plus data. It is
legitimate when each page has unique, useful content a searcher wants, and
spam when it is the same page with the noun swapped.

**Legitimate examples:**
- Integration pages, one per real integration, each with real setup steps,
  real screenshots, real limitations ("pgtypes with Supabase", "with
  Neon", "with RDS")
- Template or example galleries where each entry is a real, distinct,
  working artifact
- Data pages where you own unique data (a public status history per
  region; a benchmark per database version)
- Glossary pages where each definition is written, not generated, and
  links to real usage in your docs
- Location pages only if the service genuinely differs by location

**Spam examples (and what Google's helpful content and scaled content
abuse policies target):**
- "[Tool] for [industry]" times 200 industries with the same body
- "[Competitor] alternative" times every competitor with a swapped name
- City pages for a SaaS with no location component
- AI-generated "guides" on every long-tail query in the category
- Glossary pages that are one paragraph of generic definition

The test: would a human who landed on page 47 find something there they
could not get on page 3? If not, do not publish page 47. Sites hit by the
scaled content policies lose rankings sitewide, not just on the generated
pages, and recovery takes months.

If you do build programmatic pages: cap the set at what you can make
genuinely distinct; have a human review each; noindex any that are thin
until they are not; put them in their own sitemap so you can watch their
indexing separately in Search Console.

## 10. Comparison and alternatives pages

The highest-converting SEO content for most software products, because the
searcher is choosing right now.

**"X vs Y" pages** (you versus one competitor). The searcher wants a fair
comparison and knows it is on your site; honesty is the strategy. Structure:

1. One-paragraph summary: who should pick which. Say when the competitor
   is the better choice; this one paragraph is what makes the rest
   believable.
2. A comparison table on the dimensions the buyer cares about (not the
   dimensions where you win). Facts, with dates; competitor pricing and
   features change, so "as of October 2026".
3. Sections on the three or four differences that matter most, each with
   the mechanism and a screenshot or code sample from both.
4. Pricing comparison with worked examples at two team sizes.
5. Migration path, if the reader is switching.
6. FAQ from real questions.
7. One CTA.

Legal and ethical rules in `claims-and-compliance.md`: every factual claim
about the competitor must be true and verifiable at the time of writing;
use their public docs and pricing as sources and link them; update when
they change; no disparagement; use their name but not their logo without
checking trademark guidelines.

**"X alternatives" pages** (listing several options including you). The
searcher is unhappy with X and surveying. Structure: why people look for
alternatives to X (their real complaints, from Reddit and reviews), then
6-10 alternatives with a paragraph each, honest about each one's
strengths, with you included and not necessarily first. Pages that list
only you, or trash every alternative, do not rank and do not convert.

**"Best [category] tools" pages** are harder to rank from a vendor site
because searchers and Google prefer third-party lists; write them only if
you can be genuinely even-handed, and expect modest results. Better: get
listed on the third-party pages that already rank (outreach, with a real
reason you belong).

**Competitor-name pages: a caution.** Bidding on or heavily targeting a
competitor's brand name is legal in most jurisdictions when the content is
truthful, but it is also the thing competitors watch, and it invites
retaliation. Build the vs pages; do not build a hundred of them.

## 11. Technical SEO handoff to frontend

Marketing decides what should be crawlable and indexed and what the
metadata says; `frontend` implements it. Deliver this list:

**Crawlability and indexing**
- `robots.txt` allows crawling of marketing, docs and blog; disallows
  app, admin, API, search results pages, and parameterized duplicates
- XML sitemap(s) generated automatically, submitted in Search Console,
  split by section if large (marketing, docs, blog, programmatic)
- Canonical tag on every page; self-referencing by default; pointing to the
  original for syndicated or duplicate content
- `noindex` on thin, duplicate, or utility pages (tag archives, search
  results, thank-you pages, staging)
- No important content behind JavaScript that fails without execution;
  server-render or prerender marketing and docs pages
- Clean URLs; 301 redirects for anything moved; no redirect chains
- 404 page returns a 404 status (not a 200 "not found" page)
- Pagination with `rel="next/prev"` is no longer used by Google; ensure
  paginated pages are reachable and canonical to themselves

**Metadata**
- Unique `<title>` and `<meta name="description">` per page, from
  marketing's copy
- Open Graph and Twitter card tags with a real 1200x630 image per
  important page (this is social sharing, but the same handoff)
- `lang` attribute; `hreflang` if there are language variants

**Structured data (JSON-LD)**
- `Organization` on the homepage (name, logo, URL, sameAs social links)
- `SoftwareApplication` on the product page (name, operating system,
  category, offers with price if public, aggregateRating only if real and
  compliant)
- `Article` with author, dates and publisher on posts
- `BreadcrumbList` on docs and blog
- `FAQPage` only where FAQ content is real (rich results are now limited)
- Validate with Google's Rich Results Test

**Performance (Core Web Vitals, shared with design's budgets)**
- LCP under 2.5s (good) on mobile; design targets 2.0s on marketing pages
- INP under 200ms
- CLS under 0.1 (design targets 0.05)
- Images: modern formats, explicit dimensions, lazy load below fold
- Fonts: preloaded, `font-display: swap`, subset

**Content hygiene**
- Heading hierarchy (one H1, logical H2/H3)
- Descriptive `alt` text on content images; empty `alt` on decorative
- Visible publish and update dates

**Monitoring**
- Google Search Console verified (domain property), sitemap submitted
- Bing Webmaster Tools verified (free; also feeds some AI engines)
- Core Web Vitals report checked monthly

## 12. E-E-A-T for a small team

Experience, Expertise, Authoritativeness, Trustworthiness: Google's quality
rater guidelines describe what they want to reward, and its systems try to
approximate it. For a small software team, this is an advantage: you have
real experience with the thing you build, and content farms do not.

Make it visible:
- **Named authors** with real bios, photos, and links to GitHub, talks,
  other writing. Anonymous "Team" bylines lose.
- **First-person experience** in the content: "we hit this on a 200-table
  schema", "in the 40 schemas we have generated for", screenshots of real
  output. This is also the content AI cannot write.
- **Specifics that only a practitioner knows.** The edge case, the version
  where it broke, the workaround.
- **Citations** to primary sources (specs, docs, papers) rather than to
  other blog posts.
- **An About page** that says who you are, where you are, and how to reach
  you; a legal entity name; a physical address if B2B.
- **Consistency**: the same name and bio across your site, GitHub, LinkedIn,
  conference pages.
- **Honesty about limitations** reads as trustworthiness to raters and
  readers alike.
- **Reviews and mentions** on third-party sites (G2, Capterra, GitHub
  stars, Reddit threads) that corroborate claims.

## 13. AI overviews and answer engines

Google's AI Overviews, ChatGPT search, Perplexity, Claude's web search and
similar systems now answer many informational queries directly, reducing
clicks to the pages they summarize. What this changes for a small team:

- **Informational top-of-funnel traffic is shrinking** and will keep
  shrinking. Do not build the strategy on it.
- **Commercial and transactional queries are less affected**; the engines
  tend to cite and link sources for "best X" and "X vs Y" queries, and
  users click through to compare. These were already the priority.
- **Being cited is the new being ranked** for informational queries. The
  engines favour pages that answer directly, are well structured (clear
  headings, short definitive paragraphs, tables), come from identifiable
  sources, and are corroborated elsewhere. The on-page checklist above
  already produces this.
- **Docs and READMEs get cited heavily** for developer queries. Make them
  crawlable and precise; a well-structured docs page is often the cited
  source for "how to X with Y".
- **Entity consistency** matters more: the engines build a model of what
  your product is from everywhere it is mentioned. A consistent one-liner
  across the site, GitHub, package registries, directories, and social
  profiles helps them describe you correctly.
- **Allow the crawlers** (GPTBot, ClaudeBot, PerplexityBot, Google-Extended)
  in `robots.txt` for marketing and docs if you want to be cited; block
  them if you do not. This is a business decision, not a technical one;
  state it explicitly.
- **Measure citations** by searching your category queries in the engines
  monthly and noting whether you appear and how you are described. There is
  no Search Console for this yet; a manual spreadsheet is the state of the
  art.
- **Write the definitive short answer** at the top of informational pages
  (40-60 words), then the depth. The short answer is what gets quoted; the
  depth is why a human clicks.

## 14. Measuring: the Search Console workflow

Google Search Console is free and sufficient for a small site. A monthly
pass:

1. **Performance, last 3 months vs previous 3 months.** Total clicks and
   impressions trend. Note any step change and check the date against
   deploys and Google updates.
2. **Queries tab, filter position 5-20, sort by impressions.** These are
   pages that almost rank. Improve the page: answer the query more
   directly in the first 100 words, add a missing section, add internal
   links to it, update the date.
3. **Pages tab, sort by impressions, look at CTR.** A page with high
   impressions and low CTR (under 2% at positions 1-5) has a title or
   description problem; rewrite them as a reason to click.
4. **Queries you did not expect.** Search Console shows what you rank for
   accidentally; sometimes a page is ranking for a query it does not
   answer well, and a dedicated page would convert.
5. **Indexing report.** Pages excluded and why; fix "crawled, not indexed"
   on pages that matter (usually thin content or weak internal linking);
   confirm noindex pages are the ones you intended.
6. **Core Web Vitals report.** Any URL group in "poor" goes to frontend.
7. **Links report.** New external links; who is linking; thank them, and
   note what content earned links (it tells you what to write more of).

Connect Search Console to your analytics so you can see search landing
pages through to signup; the conversion rate by landing page is the
number that decides what to write next.

Set expectations with the user: new pages take 1-3 months to be indexed
and settle, 3-9 months to rank competitively; a new domain takes longer.
Judge SEO quarterly, not weekly.

## 15. Refresh strategy

Existing content that already ranks is cheaper to improve than new content
is to rank. Quarterly:

- List pages with declining clicks over two quarters.
- For each: is the information outdated (versions, prices, screenshots)? Is
  a competitor's page now better? Has the query intent shifted (check the
  SERP)?
- Update facts, add the missing section, replace stale screenshots, improve
  the first 100 words, add new internal links from recent content, update
  the visible "last updated" date (only when you actually updated
  substance; fake refresh dates are detected).
- Merge pages that cannibalize each other (two pages ranking for the same
  query, both at position 8); 301 the weaker to the stronger.
- Prune pages with no impressions, no links and no purpose; 301 them to
  the closest relevant page. Fewer, better pages outrank many thin ones.
- Comparison and pricing pages: check competitor facts every quarter; a
  stale price on a vs page is a credibility and legal problem.

## 16. Failure modes

- **Writing for robots.** Keyword in every H2, 2,000 words of definition,
  no experience, no opinion. Does not rank now; gets a site flagged as
  unhelpful.
- **Chasing volume.** Ranking for a broad term that converts no one while
  ignoring the "alternative to X" query that converts a tenth of its
  searchers.
- **No brief.** A post that targets no query and satisfies no intent.
- **Ignoring the SERP.** Writing a tutorial for a query where every result
  is a listicle.
- **Programmatic pages with swapped nouns.** Sitewide penalty.
- **Dishonest comparison pages.** Do not rank (users bounce), do not
  convert (users do not believe them), and create legal exposure.
- **Gated or JavaScript-only content.** Invisible to crawlers.
- **One-and-done.** Publishing and never updating; SEO content is a garden.
- **Judging weekly.** Search is slow; the team gives up at month two, just
  before it works.
- **Orphan pages.** Published, linked from nowhere, never indexed.
- **Fake freshness.** Updating the date without the content.
- **Ignoring Search Console.** The data that tells you what to do next is
  free and unread.
