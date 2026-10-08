# Search, time series, and vectors

Three workloads that tempt people into a second database before they need
one: full-text search (Postgres FTS and trigram versus Elasticsearch/
OpenSearch/Meilisearch/Typesense), time series (plain partitioned Postgres,
TimescaleDB, ClickHouse, InfluxDB), and vector similarity (pgvector with
HNSW/IVFFlat, dedicated vector databases, hybrid search). For each: how to
do it well in Postgres, where the ceiling is, and what a dedicated engine
buys.

## Contents

1. Full-text search
2. Time series
3. Vector search
4. Hybrid search
5. Decision summary

## 1. Full-text search

### Postgres FTS

`tsvector` (normalized lexemes with positions) and `tsquery`, matched
with `@@`, indexed with GIN, ranked with `ts_rank`/`ts_rank_cd`.

```sql
alter table articles add column search tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'C')
  ) stored;
create index concurrently articles_search_idx on articles using gin (search);

select id, title, ts_rank_cd(search, q) as rank,
       ts_headline('english', body, q, 'MaxFragments=2, MaxWords=20') as snippet
from articles, websearch_to_tsquery('english', $1) q
where search @@ q
order by rank desc
limit 20;
```

- `websearch_to_tsquery` accepts Google-like syntax (`"exact phrase"`,
  `-excluded`, `or`); `plainto_tsquery` for plain words; `to_tsquery` for
  the raw operator syntax (`&`, `|`, `!`, `<->` for adjacency).
- The text search configuration (`'english'`) does stemming and stopword
  removal per language; `'simple'` for no stemming (codes, names);
  multilingual content needs a `language` column and per-row
  configuration, or `simple`.
- Ranking: `ts_rank_cd` considers proximity; both are not BM25 and do not
  account for document frequency across the corpus. Good enough for most
  product search; not competitive with Lucene for relevance tuning.
- Filter with other predicates in the same query (`and tenant_id = $2`);
  a composite `(tenant_id)` B-tree plus the GIN bitmap-AND is fine, or a
  GIN index with `btree_gin` including `tenant_id`.
- Typo tolerance: FTS has none. Add `pg_trgm` for fuzzy matching on
  short fields (names, titles):

```sql
create extension if not exists pg_trgm;
create index concurrently products_name_trgm on products using gin (name gin_trgm_ops);
select name, similarity(name, $1) as s from products
where name % $1                   -- similarity above pg_trgm.similarity_threshold (0.3)
order by s desc limit 10;
-- also makes `where name ilike '%' || $1 || '%'` an index scan
```

- Autocomplete: prefix queries `to_tsquery('english', $1 || ':*')` or a
  trigram index with `like 'prefix%'`; for best latency, a dedicated
  `suggestions` table keyed by normalized prefix.
- Highlighting: `ts_headline` (slow on large bodies; run only for the
  returned page).
- Faceting (counts per category for the result set): a second query
  with `count(*) ... group by category` on the same `where`; fine to
  hundreds of thousands of matches.
- Scale: GIN indexes on millions of medium documents are fine; update
  cost is the pain (GIN pending list, `fastupdate`); very high write
  rates on searchable text want `gin_pending_list_limit` tuning or a
  dedicated engine.

### When a dedicated engine earns its keep

Elasticsearch/OpenSearch, Meilisearch, Typesense, Algolia, Vespa:

- Relevance tuning beyond stemming: BM25, field boosting with
  per-query weights, synonyms, decay functions, learning-to-rank,
  per-language analyzers side by side.
- Typo tolerance and prefix search as first-class, instant (Meilisearch,
  Typesense, Algolia are built for the search-as-you-type box).
- Faceted navigation over millions of documents with sub-50ms counts.
- Aggregations and log analytics at scale (Elastic's origin story).
- Horizontal scale of the search index independent of the primary DB.

Costs: a second system to run, a sync pipeline (CDC/outbox/dual write)
and the eventual consistency that comes with it, re-indexing on mapping
changes, and the security surface of another service. Keep Postgres as
the source of truth and treat the index as a derived, rebuildable view;
design the sync so a full rebuild from the database is a routine command.

Rule of thumb: start with Postgres FTS plus `pg_trgm`. Move when users
complain about relevance or typos, or when the search box is the
product.

## 2. Time series

Append-mostly rows keyed by time (metrics, events, IoT readings, prices,
logs). Characteristics: enormous insert rates, queries over time ranges
with aggregation, old data compressed or dropped.

### Plain Postgres, partitioned

For moderate volumes (tens of thousands of rows/sec, hundreds of GB), a
range-partitioned table with a BRIN or composite B-tree index and
scheduled partition drops is enough (`postgres.md` section 4):

```sql
create table metrics (
  device_id bigint not null,
  ts        timestamptz not null,
  value     double precision not null,
  tags      jsonb
) partition by range (ts);
create index on metrics (device_id, ts desc);           -- "latest N for a device"
create index on metrics using brin (ts);                 -- cheap range pruning within partitions

-- downsampling into a rollup table (hourly), run by pg_cron
insert into metrics_hourly (device_id, hour, avg_value, max_value, n)
select device_id, date_trunc('hour', ts), avg(value), max(value), count(*)
from metrics
where ts >= $1 and ts < $2
group by 1, 2
on conflict (device_id, hour) do update
  set avg_value = excluded.avg_value, max_value = excluded.max_value, n = excluded.n;
```

Practices: batch inserts (`COPY` or multi-row `VALUES`), no updates, no
FKs on the hot table (the device table is referenced loosely; validate
at ingest), narrow rows (`double precision`, not `numeric`; `smallint`
enum codes, not `text`), tags normalized into a `series` table with an
`id` the metrics row references instead of repeating `jsonb` per row,
`fillfactor = 100`, aggressive autovacuum off (inserts only; but
`autovacuum_vacuum_insert_threshold` on PG 13+ keeps the visibility map
fresh for index-only scans).

### TimescaleDB

A Postgres extension that automates the above and adds more:

- `create_hypertable('metrics', 'ts', chunk_time_interval => interval '1
  day')`: automatic partitioning (chunks) by time and optionally by a
  space key.
- **Compression** (`alter table metrics set (timescaledb.compress,
  timescaledb.compress_segmentby = 'device_id')` plus a policy): 90%+
  storage reduction with columnar chunk storage; compressed chunks are
  read-optimized and now support inserts/updates with caveats.
- **Continuous aggregates**: materialized views refreshed incrementally
  (`create materialized view metrics_hourly with (timescaledb.continuous)
  as select time_bucket('1 hour', ts) ...`) with real-time aggregation
  over the not-yet-materialized tail.
- **Retention policies**: `add_retention_policy('metrics', interval '90
  days')`.
- Hyperfunctions: `time_bucket`, `time_bucket_gapfill`, `first`/`last`,
  `locf`, percentile approximations.

It is still Postgres: joins to your relational tables, same drivers, same
backups. Available on Timescale Cloud, self-hosted, and some managed
hosts (not RDS; yes on some others). Choose it when the time-series part
is significant but you want one database.

### ClickHouse, InfluxDB, QuestDB, Druid, and warehouses

Columnar stores for analytics-scale time series (billions of rows,
sub-second aggregates over all history, very high ingest):

- **ClickHouse**: columnar, `MergeTree` engines, blazing aggregates,
  eventual-consistency-flavored inserts (batch them; async inserts),
  weak update/delete (mutations), no real transactions, joins are
  possible but shaped differently. The default for product analytics and
  logs at scale. Materialized views for rollups.
- **InfluxDB**: purpose-built metrics store with its own query languages
  (InfluxQL/Flux, SQL in v3); fine for infrastructure metrics; less
  general.
- **Prometheus/VictoriaMetrics/Mimir**: for operational metrics
  specifically, not application data.
- **BigQuery/Snowflake/Redshift**: warehouses; batch-oriented, priced per
  scan; feed via CDC or scheduled exports; not for serving user-facing
  queries with latency requirements.

Move when: ingest exceeds what Postgres absorbs after batching (roughly
>100k rows/sec sustained), queries aggregate over billions of rows
interactively, or storage cost of row-oriented Postgres becomes the
budget line. Keep Postgres for the entities; stream events out via
Kafka/Redpanda/CDC or dual write with an outbox.

## 3. Vector search

Embeddings (arrays of 384-3072 floats from a model) compared by cosine,
inner product or L2 distance, for semantic search, RAG retrieval,
recommendations, deduplication.

### pgvector

```sql
create extension if not exists vector;

create table chunks (
  id          bigint generated always as identity primary key,
  document_id bigint not null references documents(id) on delete cascade,
  tenant_id   bigint not null,
  content     text not null,
  embedding   vector(1536) not null,         -- dimension fixed per column; must match the model
  created_at  timestamptz not null default now()
);

-- HNSW: best recall/latency trade for most cases; build is memory-hungry
create index concurrently chunks_embedding_hnsw on chunks
  using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 64);

-- query: nearest 10 by cosine distance (<=>), filtered by tenant
set local hnsw.ef_search = 100;                -- higher = better recall, slower; default 40
select id, content, embedding <=> $1 as distance
from chunks
where tenant_id = $2
order by embedding <=> $1
limit 10;
```

Operators: `<->` L2, `<#>` negative inner product (so `order by` ascending
works), `<=>` cosine distance. Index opclass must match the operator you
query with (`vector_cosine_ops`, `vector_l2_ops`, `vector_ip_ops`).
Normalize embeddings and inner product equals cosine; most embedding
APIs return normalized vectors.

HNSW vs IVFFlat:

| | HNSW | IVFFlat |
|---|---|---|
| Build | Slow, memory heavy (`maintenance_work_mem` ≥ index size, else very slow) | Fast; needs data present first (`lists` clustering) |
| Query | Fast, high recall, tunable `ef_search` | Fast; recall depends on `probes` (`set ivfflat.probes = 10`) |
| Updates | Fine | Clusters drift; rebuild periodically |
| Size | Larger | Smaller |
| Use | Default | Very large tables where HNSW build cost is prohibitive, or memory-constrained |

Filtering: `where tenant_id = $2` with an HNSW index does post-filtering
(the index returns the nearest `ef_search` candidates, then the filter
applies), so a selective filter can return fewer than `limit` rows.
pgvector 0.8+ has iterative scans (`hnsw.iterative_scan = relaxed_order`)
that keep scanning until `limit` is satisfied. For strict per-tenant
isolation at scale, partition by tenant or use partial indexes per large
tenant. Exact search (`set enable_indexscan = off`, or no index) is
correct and slow; fine up to ~100k rows.

Dimensions and storage: 1536 floats × 4 bytes = 6 KB per row before
TOAST; `halfvec(1536)` (16-bit) halves it with negligible recall loss;
`bit` for binary quantization with a re-rank. Index limits: 2000
dimensions for `vector` HNSW, 4000 for `halfvec`. Store the model name
and version alongside the embedding (a column or a table), because
changing models means re-embedding everything and vectors from different
models cannot be compared.

Operational: HNSW builds want `maintenance_work_mem` of several GB and
`max_parallel_maintenance_workers`; build on a replica or off-hours for
large tables. `pgvectorscale` (Timescale) adds StreamingDiskANN for
larger-than-memory indexes.

### Dedicated vector databases

Pinecone, Qdrant, Weaviate, Milvus, Chroma, Vespa, Turbopuffer, and the
vector features in Elasticsearch/OpenSearch/Redis/MongoDB Atlas:

- Scale past what fits one Postgres instance (hundreds of millions to
  billions of vectors), with sharding and disk-based indexes built in.
- Filtering integrated into the ANN search (pre-filtering) for
  high-cardinality metadata.
- Multi-vector documents, named vectors, built-in hybrid (BM25 + vector)
  ranking, quantization options.
- Managed scaling and no impact on your OLTP database's memory.

Costs: a second store, a sync problem, eventual consistency, and
embedding IDs that must be reconciled with your relational rows. For
most applications under ~10-50M vectors, pgvector in the existing
database is simpler and plenty fast; move when latency, recall or
memory on the shared instance becomes the constraint.

## 4. Hybrid search

Lexical search finds exact terms (product codes, names, rare words);
vector search finds meaning. Combining them beats either. In Postgres:

```sql
with lexical as (
  select id, row_number() over (order by ts_rank_cd(search, q) desc) as rank
  from chunks, websearch_to_tsquery('english', $1) q
  where search @@ q and tenant_id = $3
  limit 50
),
semantic as (
  select id, row_number() over (order by embedding <=> $2) as rank
  from chunks
  where tenant_id = $3
  order by embedding <=> $2
  limit 50
)
select coalesce(l.id, s.id) as id,
       coalesce(1.0 / (60 + l.rank), 0) + coalesce(1.0 / (60 + s.rank), 0) as rrf_score   -- reciprocal rank fusion, k = 60
from lexical l full outer join semantic s using (id)
order by rrf_score desc
limit 10;
```

Reciprocal rank fusion needs no score normalization and works well as a
default. Then optionally re-rank the top 20-50 with a cross-encoder in
the application. Keep both indexes (GIN on `search`, HNSW on
`embedding`) on the same table; chunking strategy (size, overlap) matters
more for retrieval quality than the fusion formula.

## 5. Decision summary

| Workload | Start with | Move to | When |
|---|---|---|---|
| Product/content search | Postgres FTS + `pg_trgm` | Meilisearch/Typesense (UX-first) or Elastic/OpenSearch (analytics, scale) | Relevance or typo complaints; search is the product; >10M docs with facets |
| Log/analytics search | Postgres partitioned (small) | OpenSearch, ClickHouse, Loki | Volume |
| Metrics / IoT / events | Partitioned Postgres with rollups | TimescaleDB (same DB) → ClickHouse (separate) | Ingest >50-100k rows/s, storage cost, interactive aggregates over billions |
| Embeddings | pgvector HNSW | Dedicated vector DB | >50M vectors, strict filtered ANN, memory pressure on the primary |
| All of the above together | One Postgres with extensions | Specialized per workload with CDC feeds | When any single workload dominates the instance |
