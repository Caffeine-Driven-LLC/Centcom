# NoSQL: documents, key-value, wide-column, realtime

How to model when the store is not relational, and how to tell when it
should have been. Covers document modeling in general (embed vs reference,
access-pattern-first), MongoDB indexes and aggregation pitfalls, DynamoDB
single-table design, Redis data structures as a store (as opposed to a
cache, which is `backend/references/caching.md`), Firestore and Supabase
realtime modeling, and an honest list of when not to use any of this.

## Contents

1. The decision: when NoSQL fits
2. Document modeling: access-pattern-first
3. MongoDB specifics
4. DynamoDB and single-table design
5. Redis as a store
6. Firestore
7. Supabase realtime (Postgres, but modeled for subscriptions)
8. Consistency, transactions, and what you give up
9. Migrating between models

## 1. The decision: when NoSQL fits

A document or key-value store wins when most of these are true:

- The data is a self-contained aggregate with one owner and one dominant
  access path (a user's shopping cart, a device's config, a game save).
- Reads and writes are by key or by one or two well-known patterns; you
  are not going to ask new questions of the data next quarter.
- Scale is horizontal by nature (per-user, per-device, per-tenant
  partitions) and single-digit-millisecond latency at very high
  throughput matters more than ad hoc queries.
- Schema varies legitimately per document (plugin settings, IoT payloads).
- The team already runs it and the operational muscle exists.

It loses when:

- Entities relate many-to-many and are read from several directions
  (orders by customer, by product, by region, by date). Every new
  direction in a document store is a new denormalized copy or a scan.
- Invariants span documents (inventory and orders; balances and
  transfers). You will reimplement transactions badly.
- Reporting and analytics are a requirement rather than an afterthought.
- "Flexible schema" is the stated reason. Flexible schema means the schema
  lives in the application code, in every version that ever wrote a
  document, forever. Postgres `jsonb` gives you a flexible column inside a
  schema with constraints around it.

The default answer for a product with users, things they own, and
relationships between those things is a relational database. Use NoSQL
for the parts that fit it, often alongside.

## 2. Document modeling: access-pattern-first

Relational modeling starts from the data; document modeling starts from
the queries. Write the access patterns first, then shape documents so each
pattern is one read.

### Embed vs reference

| Embed when | Reference when |
|---|---|
| Child is always read with the parent (order lines with the order) | Child is read on its own (comments listed across posts) |
| Child has one parent and no life of its own | Child is shared by many parents (product referenced by many orders) |
| Bounded, small cardinality (addresses on a customer) | Unbounded growth (events on a device; Mongo's 16 MB document limit and the cost of rewriting a large doc on every append) |
| Updated with the parent | Updated independently and frequently (a hot counter inside a large doc is rewritten whole) |
| Consistency within the aggregate matters more than dedup | Dedup matters: the referenced thing changes and all parents must see it |

The "subset" pattern: embed the ten most recent comments in the post for
the list page, keep the full set in a `comments` collection. The
"extended reference" pattern: embed the fields of the referenced thing
you display (product name and price at order time) and reference the ID
for the rest. Both are explicit denormalization; state what keeps them
fresh (or that they are snapshots).

### Shape rules

- One document per aggregate root; the aggregate is the transaction
  boundary in most document stores (Mongo has multi-doc transactions now,
  at a cost).
- Every document carries a `type`/`kind` field when a collection holds
  more than one shape, and a `schemaVersion` so readers can upgrade lazily.
- Keys are chosen, not random, when the key is the access path (`user#42`,
  `device:abc:config`).
- Avoid arrays that grow without bound; avoid arrays you need to update by
  index.
- Model for the write amplification you can afford: a fan-out-on-write
  feed (copy the post into each follower's timeline) is right for Twitter
  scale read patterns and wrong for a 50-user intranet.

## 3. MongoDB specifics

### Schema validation exists; use it

```js
db.createCollection("orders", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["customerId", "status", "lines", "createdAt"],
      properties: {
        customerId: { bsonType: "objectId" },
        status: { enum: ["draft", "placed", "paid", "shipped", "cancelled"] },
        totalCents: { bsonType: "long", minimum: 0 },
        lines: { bsonType: "array", minItems: 1, items: { bsonType: "object", required: ["productId","qty","priceCents"] } },
        createdAt: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict", validationAction: "error"
});
```

Mongoose schemas validate in the application only; a script or another
service bypasses them. Collection-level validation is the database
constraint.

### Indexes

- Every query's filter plus sort should be covered by one compound index,
  built with the **ESR rule**: Equality fields first, then Sort fields,
  then Range fields. `find({ customerId, status }).sort({ createdAt: -1 })`
  wants `{ customerId: 1, status: 1, createdAt: -1 }`.
- `explain("executionStats")` shows `totalDocsExamined` vs `nReturned`;
  a ratio far above 1 means a missing or wrong index. `COLLSCAN` is the
  seq scan. `SORT` stage in memory with `memLimit` exceeded fails the
  query (100 MB) unless `allowDiskUse`.
- Multikey indexes (on array fields) can only have one array field per
  compound index.
- Partial indexes (`partialFilterExpression`) and sparse indexes exist;
  unique indexes treat missing fields as `null` (so two docs missing the
  field collide unless `sparse: true` or a partial filter).
- TTL indexes (`expireAfterSeconds`) delete documents by a date field;
  the cleanest retention mechanism in Mongo.
- Text indexes exist but Atlas Search (Lucene) is the real full-text
  answer on Atlas.
- Index builds are online but consume I/O; `db.currentOp()` shows
  progress. Each index costs on every write; the "index every field"
  failure mode applies exactly.
- Default `_id` is an `ObjectId`: 12 bytes, time-prefixed, so it sorts by
  creation time, which is nice. If you store UUIDs, use `BinData` subtype
  4, not strings.

### Aggregation pitfalls

- Put `$match` first and make it use an index; later stages cannot.
  `$match` right after `$lookup` or `$unwind` is a full pass over the
  intermediate results.
- `$lookup` is a left outer join executed per input document unless the
  foreign collection's field is indexed; without that index it is N
  collection scans. Pipeline-style `$lookup` with `let` can use indexes on
  the foreign side from 5.0.
- `$unwind` on large arrays multiplies the document count; `$group`
  afterwards may blow the memory limit; use `$project` to drop unused
  fields early.
- `$group` holds its state in memory (100 MB limit before
  `allowDiskUse`); design the pipeline so the grouped key cardinality is
  known.
- `$facet` runs stages in parallel on the same input; useful for "results
  plus counts", but each sub-pipeline is limited to 16 MB output.
- Change streams are the right way to react to writes; polling the
  oplog is not.

### Transactions and consistency

Multi-document transactions exist (4.0+ on replica sets, 4.2+ sharded)
with snapshot isolation and a 60s default lifetime. They are slower and
hold locks; design aggregates so most operations are single-document
atomic updates (`$inc`, `$push`, `findOneAndUpdate` with a filter that
encodes the precondition). Read/write concerns: `w: "majority"` and
`readConcern: "majority"` for anything you cannot afford to lose on a
failover; the defaults depend on version and driver.

### Mongoose footguns

- `populate()` is N+1 by default (one query per referenced collection,
  batched per populate call, but nested populates multiply).
- Mongoose casts and strips unknown fields silently with `strict: true`;
  with `strict: false` it stores anything. Know which one you have.
- `Model.find()` returns full documents with all fields unless you
  `.select()` or `.lean()`; `lean()` skips hydration and is 5-10x faster
  for read paths.
- Middleware (`pre('save')`) does not run on `updateOne`/`findOneAndUpdate`
  unless you add query middleware; validation also does not run on
  updates unless `runValidators: true`.

## 4. DynamoDB and single-table design

DynamoDB is a partitioned key-value store with predictable millisecond
latency at any scale, priced per request and storage. You get `GetItem`,
`PutItem`, `Query` (within one partition key, by sort key range), `Scan`
(expensive), batch operations, transactions (up to 100 items), and
secondary indexes (GSI: different partition/sort keys, eventually
consistent, own capacity; LSI: same partition key, different sort key,
must be defined at table creation).

### The method

1. List every access pattern with its inputs: "get user by id", "list
   orders for user newest first", "get order with its lines", "find user
   by email", "list orders by status for today's ops dashboard".
2. Choose a partition key (PK) and sort key (SK) per entity so that the
   most important patterns are `Query` on PK with an SK prefix or range.
   Overload generic attribute names `PK`/`SK` so one table holds every
   entity type:

   | Entity | PK | SK |
   |---|---|---|
   | User | `USER#<id>` | `PROFILE` |
   | Order | `USER#<id>` | `ORDER#<ulid>` (sortable by time) |
   | Order line | `ORDER#<id>` | `LINE#<n>` |
   | Email lookup | `EMAIL#<email>` | `USER#<id>` |

   "List orders for user newest first" is `Query PK = USER#42, SK
   begins_with ORDER#, ScanIndexForward=false`. "Get order with lines" is
   `Query PK = ORDER#<id>`.
3. Add GSIs for patterns that cross partitions ("orders by status today":
   `GSI1PK = STATUS#paid`, `GSI1SK = <createdAt>`). Sparse GSIs (only items
   with the attribute appear) are a feature: index only what needs it.
4. Avoid hot partitions: a PK like `STATUS#paid` receiving every write
   concentrates load; shard it (`STATUS#paid#<0-9>`) and fan out reads.
5. Use `TransactWriteItems` for cross-item invariants (create order and
   decrement stock) and condition expressions
   (`attribute_not_exists(PK)`) for idempotent creates and optimistic
   concurrency (`version = :expected`).
6. TTL attribute for expiry; DynamoDB Streams to react to changes.

### Costs and limits to design around

- Item size limit 400 KB; `Query` page 1 MB; `BatchGetItem` 100 items.
- Reads cost per 4 KB, writes per 1 KB; strongly consistent reads cost
  double; GSI writes cost extra. Wide items read in full even if you
  project one attribute (use GSI projections to keep hot reads small).
- `Scan` reads the whole table; it is for migrations and exports, never
  for a user-facing path. Filter expressions apply *after* the read and
  you pay for everything read.
- Schema changes are application changes: adding an access pattern often
  means a new GSI and a backfill that rewrites every item to add the
  GSI keys. Single-table design is efficient and rigid; it is the right
  trade when patterns are known and scale is real, and the wrong one for
  a product still discovering its queries.

Tools: ElectroDB and Dynamoose (Node), PynamoDB (Python), the enhanced
client in the AWS SDK for Java, `NoSQL Workbench` for modeling. DynamoDB
Local for tests.

## 5. Redis as a store

Redis as a cache is `backend/references/caching.md`. As a *store*, it
holds data that has no other home: sessions, rate-limit counters,
leaderboards, presence, queues, pub/sub, feature flags, short-lived
state. Rules for that role:

- **Persistence**: RDB snapshots (periodic, may lose minutes) and AOF
  (`appendfsync everysec`, loses at most a second). Managed Redis often
  defaults to no persistence or RDB only; check. If the data must not be
  lost, Redis is a questionable primary.
- **Memory is the dataset**: everything lives in RAM. Set `maxmemory`
  and a policy (`noeviction` for a store, `allkeys-lru` for a cache);
  with `noeviction` writes fail when full, which is what you want for a
  store rather than silent data loss.
- **Data structures are the schema**: hashes for objects (`HSET
  user:42 name "A" plan "pro"`), sorted sets for leaderboards and time
  indexes (`ZADD feed:42 <ts> <postId>`), sets for membership, lists for
  simple queues (prefer Streams), Streams for durable logs/queues with
  consumer groups, HyperLogLog for approximate counts, bitmaps for
  flags, geo sets for proximity. Pick the structure whose operations are
  your access pattern.
- **Key naming**: `type:id:field` with a consistent delimiter; set TTLs
  on anything transient (`EXPIRE`); a store with no TTLs and no deletion
  path grows until it evicts or dies.
- **Atomicity**: single commands are atomic; `MULTI/EXEC` groups without
  rollback; Lua scripts (`EVAL`) for read-modify-write (`SET NX` plus
  check); `WATCH` for optimistic transactions. Distributed locks need
  `SET key token NX PX ttl` and compare-and-delete via Lua; Redlock is
  controversial, understand the failure modes before relying on it.
- **Don't**: `KEYS *` in production (`SCAN` instead); giant values
  (>100 KB) that block the single thread; unbounded lists; Redis as a
  relational store with manual secondary indexes everywhere (at that
  point you want a database).
- Valkey, KeyDB, Dragonfly are protocol-compatible alternatives after the
  licensing changes; the modeling is identical.

## 6. Firestore

A document store with realtime listeners and offline sync, billed per
document read/write, with collections and subcollections.

- **Model for reads you will pay for**: a listener on a query receives
  every matching doc on first attach and every changed doc after; a
  "load all 10,000 messages" listener costs 10,000 reads per client per
  open. Paginate with `limit` and `startAfter`, and denormalize so a
  screen is one or two queries.
- **Subcollections** scale (a parent doc with a `messages` subcollection
  has no size limit) while arrays in the document do (1 MB doc limit).
- **Queries are index-backed only**: every compound query needs a
  composite index (the console error gives you the link), inequality
  filters were limited to one field (relaxed in 2024 but still cost
  indexes), no joins, no aggregations beyond `count()`/`sum()`/`avg()`
  (2023+), no `OR` across fields before 2023. Design the collection so
  the query is a simple equality-plus-order.
- **Security rules are the schema and the authorization layer**: write
  them for every collection, validate field types and ownership in rules
  (`request.resource.data.ownerId == request.auth.uid`), and test them
  with the emulator. Open rules in production are a data breach.
- **Write limits**: ~1 write/sec sustained per document; counters need
  distributed counters (shards) or Cloud Functions aggregation.
- **Transactions** are optimistic and retried; batched writes are atomic
  up to 500 operations.
- **Realtime fan-out**: a document with thousands of listeners is fine; a
  document updated many times per second with thousands of listeners is
  a bill.

## 7. Supabase realtime (Postgres, modeled for subscriptions)

Supabase is Postgres (so `postgres.md` applies in full, especially RLS)
with a realtime layer that broadcasts row changes over WebSockets.
Modeling notes specific to realtime:

- Realtime respects RLS for `postgres_changes` subscriptions, so RLS
  policies must be correct and cheap; every change is evaluated against
  the policy for each subscriber.
- Subscribe to narrow filters (`filter: 'room_id=eq.42'`) on indexed
  columns; a subscription to a whole table replays every change to every
  client.
- Tables must be in the `supabase_realtime` publication; large tables
  with high write rates in the publication will saturate the realtime
  server. Use Broadcast (ephemeral messages) for presence/typing
  indicators rather than writing rows.
- Keep rows small; the whole new row (and old row with `REPLICA IDENTITY
  FULL`) is sent on each change.
- Migrations live in `supabase/migrations/*.sql` and run with the CLI;
  treat them with the same zero-downtime care as any Postgres migration.

## 8. Consistency, transactions, and what you give up

| Store | Default consistency | Transactions | Secondary indexes | Joins |
|---|---|---|---|---|
| MongoDB | Primary reads strong; replica reads stale; `w:1` acknowledged by primary only | Multi-doc, snapshot, 60s, replica sets | Yes, rich | `$lookup` (limited) |
| DynamoDB | Eventually consistent reads by default; strong on request (not on GSIs) | Up to 100 items, ACID | GSI (eventual), LSI (strong) | None |
| Redis | Single node strong; replicas async | `MULTI` (no rollback), Lua | None (build with sets/zsets) | None |
| Firestore | Strong within a region; listeners eventually | Optimistic, retried | Automatic single-field, manual composite | None |
| Cassandra/ScyllaDB | Tunable per query (`QUORUM`) | Lightweight transactions (Paxos) per partition | Discouraged; model tables per query | None |

The thing you give up in all of them is the ability to ask a new question
cheaply. Budget for it: when the product asks "which customers bought
both X and Y last quarter", a relational database answers in a query; a
document store answers with a new index, a backfill, or an export to a
warehouse.

## 9. Migrating between models

- NoSQL to relational: the access patterns you already enumerated become
  the index list; embedded arrays become child tables; `type` fields
  become tables or a discriminator column. Export, transform, load into
  Postgres with `COPY`; validate counts and spot-check aggregates.
- Relational to NoSQL (rare, and usually for one hot subsystem):
  identify the aggregate, denormalize the joins into it, decide the sync
  strategy (CDC via Debezium or logical decoding, or dual writes with an
  outbox), and keep the relational copy as the source of truth until
  proven.
- Postgres `jsonb` is frequently the destination for "we wanted Mongo for
  the flexible part": same flexibility, plus constraints and joins around
  it, one database to operate.
