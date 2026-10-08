# Caching

Where caches sit between the browser and the database, how to key them,
TTL versus explicit invalidation, stampede protection, stale-while-
revalidate, what must never be cached, and the Redis patterns that come up
in every service. A cache is a correctness hazard that happens to be fast;
treat invalidation as the design, not the afterthought.

## Contents

1. Should this be cached at all?
2. The layers
3. HTTP caching: headers that work
4. CDN and edge
5. Application-level caching
6. Keys
7. TTL vs invalidation
8. Stampedes and the thundering herd
9. Stale-while-revalidate and stale-if-error
10. Consistency and read-your-writes
11. Redis patterns
12. What not to cache
13. Observability for caches
14. Anti-patterns with fixes

## 1. Should this be cached at all?

Cache when the read is expensive or slow (hundreds of ms, many queries, a
third-party call), repeated (hit rate would be meaningful: the same key is
read many times before it changes), and tolerant of some staleness (or
you can invalidate precisely). Before caching, check whether the expensive
read is just a bad query (missing index, N+1) that `database/references/`
fixes for free; a cache on top of a bad query hides the bug and adds an
invalidation problem.

Decide, per cached thing: what is the key, what is the TTL, what
invalidates it, what happens on a miss under load, what happens if the
cache is down, who sees stale data and for how long. If you cannot answer
the invalidation question, the TTL must be short enough that staleness is
acceptable.

## 2. The layers

From closest to the user to closest to the data:

| Layer | What it caches | Who controls | Typical TTL | Invalidation |
|---|---|---|---|---|
| Browser (HTTP cache, SWR libs) | Full responses, assets | `Cache-Control` headers | seconds to a year (assets) | Versioned URLs, revalidation (ETag) |
| CDN / edge | Full responses, assets | Headers + purge API | seconds to days | Purge by URL/tag/surrogate key |
| Reverse proxy (Varnish, nginx) | Responses | Headers + rules | seconds to minutes | Purge/ban |
| Application in-process (LRU map) | Objects, computed values, config | Code | seconds to minutes | TTL; per-process only |
| Distributed (Redis, Memcached) | Objects, query results, sessions, rate limits | Code | seconds to hours | TTL + explicit delete |
| Database (buffer pool, materialized views, query cache) | Pages, precomputed results | DB config | n/a | Refresh |

Cache as close to the user as the data's privacy and freshness allow.
Public, slow-changing content belongs at the CDN. Per-user data belongs
in the app layer or `Cache-Control: private` in the browser. Hot
computed objects shared across processes belong in Redis. Tiny, very hot,
rarely changing data (feature flags, config, country lists) can sit in-
process with a short TTL.

## 3. HTTP caching: headers that work

Set `Cache-Control` explicitly on every response; the absence of a header
lets intermediaries guess.

- Private per-user API responses: `Cache-Control: private, no-store` (or
  `private, max-age=0, must-revalidate` with an ETag if you want
  conditional requests). Also `Vary: Authorization, Cookie` if the same
  URL serves different users.
- Public, cacheable API responses (product catalog): `Cache-Control:
  public, max-age=60, s-maxage=300, stale-while-revalidate=60, stale-if-
  error=600` (browser 1 min, CDN 5 min, serve stale while refreshing for 1
  more min, serve stale for 10 min if origin errors).
- Immutable assets with hashed filenames: `Cache-Control: public, max-age
  =31536000, immutable`.
- HTML / app shell: `Cache-Control: no-cache` (always revalidate) with an
  ETag so unchanged pages return 304.

Conditional requests: send `ETag` (hash of the body or a version) and/or
`Last-Modified`; handle `If-None-Match` / `If-Modified-Since` by returning
`304 Not Modified` with no body. Compute the ETag cheaply (from a
`version`/`updated_at` column, not by rendering the body first) or the
304 saves bandwidth but not compute. Weak ETags (`W/"..."`) when
semantically-equal responses may differ byte-wise (compression).

`Vary` tells caches which request headers change the response (`Accept-
Encoding`, `Accept-Language`, `Authorization`). Omitting it serves one
user's response to another; over-specifying (`Vary: Cookie` on public
pages) kills the hit rate.

## 4. CDN and edge

Put a CDN in front of public GETs and assets. Key decisions:

- **Cache key**: defaults to URL + `Vary`. Normalize query strings (sort,
  drop tracking params) at the edge or the hit rate collapses.
- **Purge**: by URL for single resources; by tag/surrogate key (`Surrogate-
  Key: product-42 category-7` on the response; purge `product-42` on
  update) for anything that appears in many URLs. Fastly, Cloudflare
  (Cache-Tag), Akamai, CloudFront (via invalidation, slower) support some
  form. Purge is the invalidation mechanism for CDNs; design responses to
  carry tags from day one.
- **Shielding / origin shield**: one edge region fetches from origin and
  others fetch from it; cuts origin load during a miss storm.
- **Edge compute** (Workers, Lambda@Edge, Vercel Edge) can personalize
  cached HTML (inject user name) without losing the cache for the shell.
- Never let the CDN cache responses with `Set-Cookie` or `Authorization`-
  dependent bodies unless `private` is respected; configure "bypass cache
  on cookie" rules carefully.

## 5. Application-level caching

Two shapes:

**Cache-aside (lazy)**: read cache; on miss, read origin, write cache,
return. Simple, only caches what is read. Default.

```ts
export async function getProduct(id: string): Promise<Product> {
  const key = `product:v2:${id}`;
  const hit = await redis.get(key);
  if (hit) return ProductSchema.parse(JSON.parse(hit));            // validate; cache contents are untrusted after a deploy
  const product = await db.products.findById(id);
  if (!product) throw errors.notFound("product");
  await redis.set(key, JSON.stringify(product), "EX", 300 + jitter(60));
  return product;
}
```

**Write-through / write-behind**: update cache on write (through: sync;
behind: async). Keeps hot keys warm and consistent at the cost of writing
things nobody reads. Use write-through for small, always-read objects
(user profile, account settings) where a miss after a write would be
visible.

**Read-through** (the cache library wraps the loader) is cache-aside with
less boilerplate: `cache.get(key, loader, ttl)`. Rails `Rails.cache.fetch`,
Laravel `Cache::remember`, Spring `@Cacheable`, Django `cache.get_or_set`,
Go `singleflight` + a store, Node `cache-manager`/`keyv`, Rust `moka`.

Where to put it: in the service/repository layer around the expensive
read, not in the controller (so every caller benefits) and not deep in
the ORM (so invalidation logic has a home). Memoize per request (a
request-scoped map or DataLoader) for repeated reads within one request;
that is different from and composable with a shared cache.

## 6. Keys

A key must identify everything that affects the value: entity, ID,
representation version, and any parameter (locale, currency, tenant,
viewer role if the value depends on it).

Pattern: `<namespace>:<entity>:<schema-version>:<id>[:<param>=<value>...]`,
e.g. `shop:product:v3:42:locale=de:currency=EUR`.

- Include a **schema version** you bump when the cached shape changes.
  Deploying new code that reads old cached shapes is a classic outage;
  the version bump makes old keys unreachable (they expire by TTL).
- **Tenant/user scoping** when values differ per tenant/user; never let
  one tenant's cached value be served to another because the key forgot
  the tenant.
- Normalize parameters (sort, lowercase, canonical form) so the same
  logical query hits the same key.
- Hash long keys (`sha256` of the normalized query) when they would exceed
  a few hundred bytes; keep a readable prefix for debugging.
- Never build keys from unbounded user input directly (a search query as
  key = cache flooding). Bound it (hash, length cap) and set a short TTL,
  or do not cache per-query results.

## 7. TTL vs invalidation

**TTL only**: simplest; staleness bounded by the TTL; no coupling between
writers and the cache. Right when some staleness is fine (product
descriptions for 5 min, exchange rates for 1 min, config for 30 s) or
when invalidation is impractical (many writers, derived data). Add jitter
to TTLs (±10-20%) so keys populated together do not expire together.

**Explicit invalidation**: on write, delete (preferred) or update the
affected keys. Precise, but every write path must know every key that
depends on the data. Use a tag/dependency map when one write affects
many keys (product update → `product:42`, `category:7:list`, `search:*`
is where it breaks down; use CDN tags or versioned keys instead).

**Versioned keys** (generation numbers): store `product:42:version = 17`;
compute cache keys as `product:42:v17:...`; on write, increment the
version. No deletes needed, old keys expire by TTL. Works for lists too
(`category:7:gen`). Cost: one extra read per lookup (cache it in-process
briefly).

**Event-driven**: writers publish `product.updated`; a consumer purges
caches and CDN tags. Decouples writers from cache knowledge; eventually
consistent by a few hundred ms.

Rule: prefer *delete* over *set* on invalidation (a concurrent reader
might set a stale value after your set; delete-then-lazy-fill with short
TTL is safer), and in a transaction, invalidate *after* commit (an
invalidation before commit lets a reader refill the cache with the old
value).

## 8. Stampedes and the thundering herd

When a hot key expires, every concurrent request misses and hits the
origin at once. Defenses, use one or more:

- **Request coalescing / single flight**: only one caller per key fetches
  from origin; others wait for its result. Go `golang.org/x/sync/
  singleflight`; Node: a `Map<key, Promise>` of in-flight loads; Python: an
  `asyncio.Lock` per key or a `dict` of futures; Java `Caffeine` does it
  natively (`get(key, loader)`); Rust `moka` too. This works per process;
  across processes use a distributed lock (below) or accept N-process
  concurrency.
- **Distributed lock on refresh**: `SET lock:product:42 <token> NX PX 5000`;
  the winner refreshes, others serve stale (if available) or wait briefly
  and retry the cache. Release with a Lua compare-and-delete.
- **Probabilistic early expiration** (XFetch): each reader recomputes early
  with probability increasing as expiry approaches, so refresh happens
  before expiry and only by one or few callers. `delta * beta * ln(rand())`
  trick; `beta = 1`.
- **Stale-while-revalidate** (section 9): never let a hot key hard-expire;
  serve stale and refresh in the background.
- **Jittered TTLs** so mass expiry does not line up.
- **Warm on deploy/startup** for a known hot set; refresh via a scheduled
  job rather than on demand for the hottest keys.

```go
var group singleflight.Group

func (c *ProductCache) Get(ctx context.Context, id string) (*Product, error) {
    if p, ok := c.store.Get(id); ok { return p, nil }
    v, err, _ := group.Do(id, func() (any, error) {
        p, err := c.db.GetProduct(ctx, id)
        if err == nil { c.store.Set(id, p, 5*time.Minute+jitter(time.Minute)) }
        return p, err
    })
    if err != nil { return nil, err }
    return v.(*Product), nil
}
```

## 9. Stale-while-revalidate and stale-if-error

Store the value with two times: `fresh_until` and `stale_until`. Between
them, serve the stale value immediately and trigger one background
refresh. After `stale_until`, treat as a miss. On origin error during
refresh, keep serving stale until `stale_until` (stale-if-error) and log
it.

```python
async def get_with_swr(key: str, loader, fresh_ttl=60, stale_ttl=600):
    raw = await redis.get(key)
    if raw:
        entry = json.loads(raw)
        if entry["fresh_until"] > time.time():
            return entry["value"]
        if entry["stale_until"] > time.time():
            asyncio.create_task(refresh_once(key, loader, fresh_ttl, stale_ttl))   # background; guarded by SET NX lock
            return entry["value"]
    return await refresh_once(key, loader, fresh_ttl, stale_ttl, wait=True)
```

HTTP has the same semantics in `Cache-Control: stale-while-revalidate=N,
stale-if-error=M` for browsers and CDNs. Use SWR for anything where 1-10
minutes of staleness is invisible to users but a miss storm would hurt.
Do not use it for data where stale is wrong (balances, inventory counts
shown as authoritative, permissions).

## 10. Consistency and read-your-writes

A user who updates their profile and immediately sees the old value
reports a bug. Options: invalidate (delete) the key synchronously after
commit in the same request, so the next read misses and refills; or
write-through for that specific object; or return the written object from
the update response and have the client use it (the frontend's cache
handles this; `frontend/references/data-fetching.md`). For CDN-cached
pages, purge by tag after commit and accept ~1 s of propagation; show
the user their change from the response body in the meantime.

Permissions and security-relevant data: do not cache, or cache for
seconds and invalidate on change. A revoked role that persists in cache
for 10 minutes is a security bug (`security/references/`).

## 11. Redis patterns

- **Data types**: strings for serialized objects, hashes for partial
  updates of an object (`HSET user:42 name "..."`), sorted sets for
  leaderboards and time-ordered sets, sets for membership, lists/streams
  for queues (but use a queue library), HyperLogLog for cardinality,
  bitmaps for flags per user.
- **Always set a TTL** (`SET key val EX 300`, `EXPIRE`). Keys without TTL
  accumulate until `maxmemory` eviction kicks in and evicts the wrong
  things. Configure `maxmemory-policy allkeys-lru` (or `volatile-lru` if
  some keys must never evict) and alert on memory.
- **Avoid `KEYS`** in production (blocks the server). Use `SCAN` for
  housekeeping and design keys so you do not need pattern deletes (tags
  via sets of keys: `SADD tag:product:42 key1 key2`, then `SMEMBERS` +
  `DEL`).
- **Pipelining / MGET** to batch round trips; a loop of 100 `GET`s is 100
  RTTs.
- **Lua scripts** (or `MULTI`/`EXEC`) for atomic check-and-set logic (rate
  limiting, locks). `EVALSHA` with scripts loaded at startup.
- **Locks**: `SET lock:<name> <random-token> NX PX <ms>`; release with a
  Lua script that deletes only if the token matches. Redlock across
  several nodes only if you really need it; usually you need a lease and
  idempotent work, not a perfect lock.
- **Rate limiting**: sliding window with a sorted set per key (`ZADD`,
  `ZREMRANGEBYSCORE`, `ZCARD` in a script) or a token bucket in a hash;
  libraries exist in every stack (section 7 of `resilience.md`).
- **Serialization**: JSON is fine; MessagePack/protobuf when size
  matters. Validate on read after deploys (schema version in key).
- **Cluster**: multi-key operations need keys in the same hash slot (`{user:42}:profile`,
  `{user:42}:settings` with hash tags). Design keys for it if cluster is
  possible later.
- **Client config**: connect timeout 200 ms, command timeout 100-500 ms,
  `enableOfflineQueue: false` (ioredis) so a down Redis fails fast instead
  of queueing forever; a small pool; reconnect with backoff.
- **Fail open**: when Redis is down, a cache read should fall through to
  the origin (log, count), and a rate limiter should decide fail-open or
  fail-closed deliberately (login throttling: closed; general API: open
  with alert). Sessions in Redis down = users logged out; consider a
  database fallback for sessions.
- **Persistence**: cache-only Redis can run without persistence; sessions
  and queues need AOF or a different store.
- Memcached when you need a dumb, multi-threaded, pure LRU cache at high
  throughput and none of the data structures.

## 12. What not to cache

- Anything security-deciding without a very short TTL and invalidation
  on change: permissions, session validity, API key status, feature
  entitlements.
- Responses containing another user's data under a key that lacks the
  user/tenant.
- Error responses, unless deliberately (negative caching of 404s for a
  short time to stop a miss storm is fine; caching a 500 is not).
- Uncacheable by nature: non-idempotent operations, responses with
  `Set-Cookie`, anything with a one-time token.
- Huge objects (multi-MB blobs) in Redis; put them in object storage with
  a CDN.
- Results of unbounded user queries (search strings) at full
  cardinality; cache the top-N or normalized forms with a short TTL.
- The database's job: if a query is slow because of a missing index, fix
  the index (`database/`); do not paper over it.

## 13. Observability for caches

Per cache (and ideally per key prefix): hit rate, miss rate, latency
of hits and misses, evictions, memory, key count, and stampede/lock
contention counts. A hit rate below ~80% on something you bothered to
cache means the key is wrong, the TTL is too short, or the access pattern
does not repeat. Log cache errors at `warn` with fall-through, never as
request failures. Add `X-Cache: HIT|MISS|STALE` headers in non-production
(or always; CDNs do) to debug. More in `observability.md`.

## 14. Anti-patterns with fixes

- **Caching to hide a slow query.** Fix: EXPLAIN it first (`database/`).
- **No TTL.** Fix: every key gets one; eviction policy configured.
- **Key without tenant/user/locale/version.** Fix: section 6.
- **Invalidate before commit**, or set-on-invalidate racing with readers.
  Fix: delete after commit; lazy refill.
- **Cache set in the controller**, so the job path bypasses it and
  invalidation lives nowhere. Fix: service layer.
- **Hot key with a hard TTL** → stampede every N minutes. Fix: single
  flight + SWR + jitter.
- **`KEYS pattern*`** in a request. Fix: tags via sets, or versioned keys.
- **Caching permissions for 10 minutes.** Fix: short TTL + invalidation,
  or don't.
- **Redis down = site down** because every read awaits a queued command.
  Fix: timeouts, offline queue off, fail open to origin.
- **Caching the serialized ORM entity** across a deploy that changed it →
  deserialization errors. Fix: schema version in key; validate on read.
- **`Cache-Control` absent on API responses.** Fix: explicit header per
  endpoint class.
- **CDN caching a personalized page** because `Vary`/`private` was missing.
  Fix: `private, no-store` on per-user responses; cookie bypass rules.
- **In-process cache in a multi-process deployment** treated as shared
  (invalidate on one process, others keep stale). Fix: Redis for shared
  state; in-process only with short TTL and no invalidation dependency.
