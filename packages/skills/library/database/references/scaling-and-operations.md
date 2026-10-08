# Scaling and operations

Keeping a database healthy as it grows: connection pooling (why Postgres
needs it, PgBouncer modes and the prepared-statement trap, serverless
pooling), read replicas and replication lag, partitioning, when sharding is
actually warranted, backups and point-in-time recovery with restore drills,
the monitoring queries worth running, bloat, and capacity planning. The
application cache layer sits in `backend/references/caching.md`; this file
covers the handoff from the database side.

## Contents

1. Scaling order of operations
2. Connection pooling
3. Read replicas and replication lag
4. Partitioning for operations
5. Sharding: criteria and shapes
6. Backups, PITR, and restore drills
7. Monitoring: what to watch and the queries
8. Bloat and maintenance
9. Capacity planning
10. The cache handoff
11. Upgrades and failover

## 1. Scaling order of operations

Most databases that "need to scale" need one of the first four items.
Do them in order; each is cheaper than the next.

1. Fix the queries and indexes (`query-performance.md`, `indexing.md`).
   A single missing index is the usual cause of "we need a bigger
   instance".
2. Pool connections properly (section 2). Hundreds of idle connections
   eat memory and CPU on Postgres.
3. Tune the instance (`postgres.md` section 6, `mysql.md` section 8) and
   right-size it. Vertical scaling is boring and works far longer than
   people expect; a 64-core, 512 GB instance serves most companies.
4. Cache the hot reads that tolerate staleness (`backend/references/
   caching.md`), and precompute aggregates (materialized views, summary
   tables).
5. Read replicas for read-heavy workloads that can tolerate lag.
6. Partition large tables for maintenance and time-based retention.
7. Move write-heavy, schema-light workloads (events, logs, metrics) to a
   store built for them (`search-timeseries-vector.md`, `nosql.md`).
8. Shard, when a single primary cannot absorb the write load or the
   dataset will not fit, and only after the above.

## 2. Connection pooling

### Why Postgres needs it

Each Postgres connection is a backend process with its own memory
(several MB plus `work_mem` per sort), and the planner, locks and
snapshot management scale poorly past a few hundred active backends.
Throughput typically peaks around a few times the core count of active
connections and degrades after. Meanwhile, modern application
deployments spawn many processes/pods each with its own pool, and
serverless spawns one per concurrent invocation. 50 pods × 20
connections = 1000 backends, mostly idle, all costly.

MySQL threads are cheaper but the same principle applies at a higher
ceiling; SQLite has no server, so pooling is about serializing the writer.

### Application-side pools

Every driver/ORM has one (HikariCP, `pg.Pool`, SQLAlchemy `QueuePool`,
`pgxpool`, Django persistent connections or psycopg pool, Rails
`pool:`). Size per process: `(cores × 2) + effective_spindle_count` is
the classic formula; in practice 5-20 per process, and total across all
processes should stay under `max_connections` minus headroom for
migrations, admin and replication. Set a short acquire timeout so a
saturated pool fails fast rather than piling up requests.

### PgBouncer (and PgCat, Odyssey, Supavisor, RDS Proxy, Neon pooler)

A pooler sits between the app and Postgres and multiplexes many client
connections onto few server connections. Modes:

| Mode | Server connection assigned | Supports | Use |
|---|---|---|---|
| `session` | For the client's whole session | Everything | Compatible but barely pools (only helps if clients disconnect) |
| `transaction` | For the duration of one transaction, then returned | No session state across transactions | The default for web apps; the big multiplexing win |
| `statement` | Per statement | No multi-statement transactions | Rare; autocommit-only workloads |

In **transaction mode**, anything that lives on the server connection
beyond a transaction breaks or leaks to another client:

- **Named prepared statements** (`PREPARE`, or the driver's prepared-
  statement cache: JDBC `prepareThreshold`, `pg` `name:` option, pgx
  default mode, asyncpg's cache, Npgsql). Fix: PgBouncer 1.21+ supports
  protocol-level prepared statements with `max_prepared_statements = 200`;
  otherwise disable the client cache (`?prepareThreshold=0`,
  `prepared_statement_cache_size=0` in asyncpg, `statement_cache_size=0`
  in asyncpg/SQLAlchemy async, Prisma `?pgbouncer=true`, pgx
  `default_query_exec_mode=simple_protocol` or `exec`, Npgsql `No Reset
  On Close`... read your driver's docs).
- **`SET` (session) settings** such as `search_path`, `timezone`,
  `statement_timeout`, `app.tenant_id`. Fix: `SET LOCAL` inside the
  transaction, or per-role defaults (`ALTER ROLE ... SET`).
- **Session-level advisory locks**, `LISTEN/NOTIFY`, temp tables,
  cursors with `WITH HOLD`, `pg_stat_statements`-style session counters.
  Fix: transaction-level variants or a dedicated session-mode pool for
  those few connections.
- **`SET ROLE`** for RLS: use `SET LOCAL ROLE` in the transaction.

Sizing: `default_pool_size` (server connections per user/database pair)
around the Postgres sweet spot (e.g. 20-50 on a 16-core box),
`max_client_conn` high (thousands), `reserve_pool_size` for bursts,
`server_idle_timeout` to shed. Run PgBouncer close to the database (or as
a sidecar) and more than one for HA. Managed poolers (Supabase Supavisor,
Neon, RDS Proxy, Cloud SQL Auth Proxy with pooling, Prisma Accelerate)
have the same transaction-mode semantics; read which mode the URL you
are using implies (Supabase: port 6543 is transaction mode, 5432 is
direct/session).

### Serverless

Each function instance holds its own pool; cold starts open connections;
bursts open hundreds. Options: an external transaction-mode pooler
(above) with a tiny per-instance pool (1-2), HTTP-based drivers (Neon
serverless driver, PlanetScale serverless, Cloudflare Hyperdrive, Prisma
Accelerate, Supabase's PostgREST) that terminate connections at the edge,
or a database designed for it (DynamoDB, D1, Turso). Keep transactions
within one invocation; never hold a connection across `await` on an
external call.

## 3. Read replicas and replication lag

Streaming replication (Postgres) or binlog replication (MySQL) gives
read-only copies, asynchronous by default. The lag is usually
milliseconds and occasionally seconds to minutes (large transactions,
vacuum conflicts, network, a replica under heavy read load).

What breaks: **read-your-writes**. A user saves a profile (primary) and
the next request reads it (replica) and sees the old value. Strategies:

- Route reads that follow a write in the same request or session to the
  primary for a window (Rails `connects_to` with `delay:`, Django
  database routers with a "recently wrote" flag, Prisma read replica
  extension with manual `$primary()`, a cookie/`last_write_at` timestamp
  compared against replica lag).
- Route by query type: anonymous reads, search, reports, exports to
  replicas; anything in a user's own transactional flow to the primary.
- For strict needs, check the replica's replay LSN against the LSN
  returned after the write (`pg_current_wal_lsn()` on primary,
  `pg_last_wal_replay_lsn()` on replica) and wait or fall back.
- Synchronous replication (`synchronous_commit = remote_apply` with a
  `synchronous_standby_names` entry) removes lag at a latency cost per
  commit; usually used for one HA standby, not read scaling.

Monitor lag on the replica:

```sql
select now() - pg_last_xact_replay_timestamp() as replay_lag;   -- Postgres replica
-- MySQL replica: SHOW REPLICA STATUS\G  -> Seconds_Behind_Source (coarse); use heartbeat tables for precision
```

Replicas also serve HA (promote on primary failure), but a replica
lagging behind during a failover loses the un-replayed writes. Know your
RPO.

Logical replication (Postgres `CREATE PUBLICATION`/`SUBSCRIPTION`) is the
tool for selective replication, cross-version upgrades, and feeding other
systems (CDC via Debezium, pg_output, wal2json). It does not replicate DDL
(apply schema changes on both sides) or sequences.

## 4. Partitioning for operations

Covered structurally in `postgres.md` section 4. Operationally,
partitioning buys:

- **Instant retention**: `DROP TABLE events_2025_01` versus deleting 400M
  rows (hours, bloat, WAL, lag).
- **Smaller indexes per partition**, so recent-data queries stay in
  cache even as history grows.
- **Vacuum parallelism**: autovacuum works per partition.
- **Cheap archival**: detach a partition, dump it, drop it.

It costs: partition management (automate with `pg_partman` or a cron
that creates N months ahead and alerts if the `default` partition gets
rows), constraints that must include the key, and planning overhead when
partition counts reach thousands (keep it under a few hundred). MySQL
partitioning is similar (`PARTITION BY RANGE`) with the restriction that
every unique key must include the partition columns and FKs are not
supported on partitioned InnoDB tables.

## 5. Sharding: criteria and shapes

Shard (split rows of the same table across databases by a key) only when:

- Write throughput exceeds what one primary can do after tuning
  (sustained tens of thousands of writes/sec on well-indexed tables), or
- The dataset cannot fit the largest instance you can buy or afford, or
- Regulatory residency requires data in separate regions, or
- Tenant isolation demands separate databases anyway (and then it is
  database-per-tenant, section 9 of `data-modeling.md`, not sharding
  proper).

Not reasons: "we might need it", read load (replicas), one big table
(partitioning), slow queries (indexes).

Shapes, cheapest first:

1. **Functional split**: move a subsystem (analytics events, audit logs,
   notifications) to its own database. No cross-shard queries because the
   data was never joined much.
2. **Tenant sharding**: each tenant lives wholly on one shard; a directory
   maps `tenant_id → shard`. Almost all queries are single-tenant, so they
   are single-shard. Rebalancing moves whole tenants. This is how most
   SaaS shards, and Citus (Postgres extension) or Vitess (MySQL) automate
   it, with reference tables replicated to all shards for joins.
3. **Hash sharding by entity ID**: uniform distribution, but any query not
   keyed by that ID fans out to all shards, cross-shard joins and
   transactions become application problems, and unique constraints
   across shards need a global service.

What you give up: cross-shard joins and transactions, global unique
constraints, simple migrations (N databases), simple backups and
restores (consistent snapshots across shards are hard), ad hoc
analytics (move to a warehouse via CDC). Budget months of engineering
and a permanent increase in operational complexity. Distributed SQL
databases (CockroachDB, YugabyteDB, Spanner, TiDB, Aurora Limitless,
Neon/PlanetScale offerings) hide much of this at the cost of latency,
features (check what Postgres features are missing) and price.

## 6. Backups, PITR, and restore drills

A backup you have not restored is a hope. The design:

- **Base backups plus WAL archiving** give point-in-time recovery: restore
  the base, replay WAL to any moment before the bad `DELETE`. Tools:
  pgBackRest (the standard), barman, WAL-G; managed hosts (RDS, Cloud
  SQL, Neon, Supabase Pro+) provide PITR with a retention window (check
  it: 7 days by default on many, and "daily snapshots" is not PITR).
  MySQL: Percona XtraBackup plus binlog archiving; managed hosts likewise.
- **Logical dumps** (`pg_dump -Fc`, `mysqldump`/`mydumper`) for
  portability, per-table restores, and cross-version moves. Slow at
  scale (hours for hundreds of GB, and restore is slower), not PITR, but
  invaluable for "restore just the `orders` table from Tuesday to a side
  database and copy back the rows".
- **Snapshots** (EBS/disk) are fast and coarse; crash-consistent if the
  filesystem is; fine as a layer, not as the only layer.
- **Retention**: daily for 30 days, weekly for a year, or whatever the
  business and regulation say; and the PII retention promise must be
  consistent with backup retention.
- **Off-site and separate credentials**: a backup in the same account
  with the same keys is destroyed by the same attacker or the same
  mistake.

Define RPO (how much data loss is acceptable: "5 minutes" means WAL
archiving every minute or streaming) and RTO (how long to restore: a
10 TB restore takes hours; if the RTO is 15 minutes you need a warm
standby, not a backup). Write them down.

**Restore drill**, quarterly at least, scripted:

1. Restore the latest backup (and PITR to a chosen timestamp) into a
   fresh instance.
2. Run integrity checks (`pg_amcheck`, row counts versus production
   estimates, the application's own health checks against it).
3. Time it. Compare to RTO. Fix the gap.
4. Delete the instance. Record the result.

Also back up: the schema and migrations (in git), roles and grants
(`pg_dumpall --globals-only`), extension lists, configuration, and the
secrets needed to decrypt the backup.

Before any destructive operation in production (a contract migration
dropping a column, a mass delete): `create table x_bak_<date> as select
...` or `pg_dump -t table`, and verify the restore path for it.

## 7. Monitoring: what to watch and the queries

Dashboards (via `postgres_exporter`/`mysqld_exporter` + Grafana,
pganalyze, Datadog, CloudWatch, pgwatch2, PMM):

| Signal | Why | Threshold hint |
|---|---|---|
| Connections: active vs idle vs idle-in-transaction vs max | Pool exhaustion, leaks | Idle-in-txn > a few is a bug; total near `max_connections` is an outage pending |
| Transactions/sec, queries/sec, rows read/written | Load baseline | Compare week over week |
| p95/p99 statement latency (from `pg_stat_statements` or APM) | The thing users feel | Regression after deploy |
| Cache hit ratio (`blks_hit / (blks_hit + blks_read)`) | Working set fits memory? | < 99% on OLTP deserves a look |
| Replication lag | Read-after-write, HA RPO | Alert at seconds for OLTP |
| Lock waits, deadlocks (`pg_stat_database.deadlocks`) | Contention | Any sustained waits |
| Longest running transaction / query | Vacuum blocker, lock holder | Alert at minutes |
| Dead tuples, last autovacuum per table, table and index bloat | Bloat, wraparound | Dead > 20% of live on hot tables |
| Transaction ID age (`age(datfrozenxid)`) | Wraparound protection | Alert at 1 billion; emergency at 1.5 |
| Disk usage and growth rate, WAL volume | Capacity | Project 3-6 months out |
| Checkpoint frequency (`pg_stat_bgwriter`) | Too-small WAL causing I/O spikes | Requested checkpoints > timed |
| Temp files (`pg_stat_database.temp_bytes`) | `work_mem` too low | Rising with load |
| Sequence headroom (`int` PKs) | The silent killer | Alert at 50% of max |
| Errors by SQLSTATE in app logs | Constraint violations, timeouts, serialization failures | Spikes |

Queries to keep handy:

```sql
-- connections by state
select state, count(*) from pg_stat_activity group by 1;

-- cache hit ratio
select sum(blks_hit) * 100.0 / nullif(sum(blks_hit) + sum(blks_read), 0) as hit_pct from pg_stat_database;

-- table sizes
select relname, pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_size_pretty(pg_relation_size(c.oid)) as table_only
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc limit 20;

-- sequence headroom
select sequencename, last_value, max_value,
       round(100.0 * last_value / max_value, 2) as pct_used
from pg_sequences where last_value is not null order by pct_used desc;

-- wraparound
select datname, age(datfrozenxid) from pg_database order by 2 desc;

-- what is waiting on what: see transactions-and-concurrency.md section 6
```

Set alerts on: connection saturation, replication lag, long transactions,
disk > 80%, wraparound age, sequence > 50%, backup job failure, restore
drill overdue.

## 8. Bloat and maintenance

Covered mechanically in `postgres.md` section 7. Operational routine:

- Tune autovacuum per hot table rather than globally; watch
  `n_dead_tup` trend after changes.
- Kill or fix long transactions and idle-in-transaction sessions; they
  block cleanup everywhere.
- Rebuild bloated indexes with `REINDEX CONCURRENTLY` (PG 12+) during a
  low-traffic window; rebuild bloated tables with `pg_repack` (never
  `VACUUM FULL` on a live table).
- After mass deletes, expect the table file not to shrink; space is
  reused by future inserts. If you need the disk back, `pg_repack`.
- MySQL: `OPTIMIZE TABLE` (online for InnoDB in most cases) after large
  deletes; `innodb_file_per_table` so space can be returned.
- Schedule `ANALYZE` after bulk loads and after major data distribution
  changes; autovacuum's analyze threshold may lag on huge tables.

## 9. Capacity planning

- Measure growth: table sizes weekly into a table or metrics store;
  project linearly and with the product roadmap (a feature that logs
  every click changes the slope).
- Working set vs RAM: the hot data (recent rows plus their indexes)
  should fit in `shared_buffers` + OS cache. When the cache hit ratio
  drops as data grows, either add RAM, partition so old data leaves the
  hot set, or archive.
- IOPS: cloud disks are provisioned; a vacuum-heavy or write-heavy
  workload can hit the IOPS ceiling before CPU. Watch disk queue and
  `I/O Timings` in EXPLAIN.
- Connection growth with horizontal app scaling: every new pod multiplies
  connections; the pooler must be in place before the pod count grows.
- Integer headroom (above). UUIDv7 or `bigint` before you need them.
- Backup and restore time grow with size; re-run the drill when the
  database doubles.
- Cost: storage is cheap, IOPS and memory are not; a table of raw
  events kept forever will dominate both. Retention policy is capacity
  planning.

## 10. The cache handoff

From the database's point of view, a cache (Redis, in-process,
materialized view, CDN) exists to remove read load that the database
would otherwise spend on identical answers. What the database side
should ensure:

- The cached query is also indexed properly, because cache misses and
  cold starts hit the database at full rate (a cache hides a missing
  index until the cache restarts).
- Invalidation has a hook: `after_commit` callbacks, `LISTEN/NOTIFY`,
  CDC, or a TTL short enough that staleness is acceptable. Row-version
  columns make cache keys trivially correct (`user:42:v7`).
- Materialized views for aggregates with `REFRESH ... CONCURRENTLY` on a
  schedule or trigger; a unique index is required for the concurrent
  refresh.
- Counters and summary tables maintained in the same transaction as the
  writes (or by a trigger) when consistency matters more than write
  speed.

Patterns, TTLs, cache-aside vs write-through, stampede protection and
what to cache live in `backend/references/caching.md`.

## 11. Upgrades and failover

- Minor version upgrades: restart; do them promptly (security and
  planner fixes).
- Major Postgres upgrades: `pg_upgrade --link` (minutes of downtime, in
  place), logical replication to a new-version instance then switch (near
  zero downtime; does not copy sequences and DDL), or the managed host's
  blue/green deployment. Test the application against the new version
  first (planner changes can regress a query); run `ANALYZE` after
  `pg_upgrade` since statistics are not carried over.
- Failover: a standby promoted by Patroni, repmgr, or the managed host;
  the application needs reconnect logic and a DNS/endpoint that moves.
  Test failover in staging under load, and know how long clients take to
  notice (TCP keepalives, driver timeouts).
- Extensions must be installed on the new version before upgrade;
  managed hosts gate versions.
- Keep a runbook: who can promote, how to find the current primary, how
  to verify replication is caught up, how to repoint the pooler.
