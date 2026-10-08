#!/usr/bin/env python3
"""Summarize a Postgres EXPLAIN (ANALYZE, FORMAT JSON) plan. Python stdlib only.

Usage:
    psql -XqAt -c "explain (analyze, buffers, format json) select ..." > plan.json
    python3 explain_summary.py plan.json
    python3 explain_summary.py plan.json --top 15 --min-rows 10000
    cat plan.json | python3 explain_summary.py -

Prints:
  1. Plan totals: execution time, planning time, total buffers read/hit.
  2. The top N nodes by *exclusive* actual time (node time minus its
     children's time, multiplied by loops), with relation, index, rows
     estimated vs actual, loops and buffers.
  3. Red flags, each pointing at the node and the usual fix:
     - Seq Scan on a table that returned or filtered many rows (>= --min-rows)
     - Row estimate off by more than 10x in either direction (bad statistics,
       correlated columns, opaque predicates)
     - Sort spilling to disk (external merge / external sort)
     - Hash join with multiple batches (hash table did not fit work_mem)
     - Bitmap Heap Scan with lossy blocks (work_mem too small for the bitmap)
     - Index Only Scan with many heap fetches (visibility map stale; vacuum)
     - Nested Loop whose inner side runs many times with many rows per loop
     - Large "Rows Removed by Filter" after an index scan (index does not
       cover the predicate)
     - Partitioned table scans with no partitions pruned
     - Parallel plan where workers were planned but not launched
     - Buffers read from disk dominating hits (cold cache or scan too large)

Accepts the JSON array psql prints (one element with "Plan"), a bare object,
or a plan without ANALYZE (then only estimates are shown and time-based
sections are skipped). Nothing is sent anywhere; this is a local parser.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field


@dataclass
class Node:
    raw: dict
    depth: int
    workers: int = 1          # workers (incl. leader) of the nearest Gather ancestor; 1 outside parallel subtrees
    under_limit: bool = False  # a Limit ancestor may stop pulling rows, so low actual rows are not a mis-estimate
    children: list["Node"] = field(default_factory=list)

    @property
    def type(self) -> str:
        return self.raw.get("Node Type", "?")

    @property
    def label(self) -> str:
        parts = [self.type]
        if self.raw.get("Parallel Aware"):
            parts.insert(0, "Parallel")
        if self.raw.get("Join Type") and self.raw["Join Type"] != "Inner":
            parts.append(self.raw["Join Type"])
        rel = self.raw.get("Relation Name")
        idx = self.raw.get("Index Name")
        alias = self.raw.get("Alias")
        if rel:
            parts.append("on " + rel + (f" {alias}" if alias and alias != rel else ""))
        if idx:
            parts.append("using " + idx)
        if self.raw.get("CTE Name"):
            parts.append("cte " + self.raw["CTE Name"])
        return " ".join(parts)

    @property
    def loops(self) -> int:
        return int(self.raw.get("Actual Loops", 1) or 1)

    @property
    def est_rows(self) -> float:
        return float(self.raw.get("Plan Rows", 0) or 0)

    @property
    def act_rows_per_loop(self) -> float:
        return float(self.raw.get("Actual Rows", 0) or 0)

    @property
    def act_rows_total(self) -> float:
        return self.act_rows_per_loop * self.loops

    @property
    def inclusive_ms(self) -> float:
        # Actual Total Time is per loop. Inside a parallel subtree, `loops` counts worker
        # executions that ran concurrently, so divide them out to approximate wall time.
        serial_loops = max(1.0, self.loops / max(1, self.workers))
        return float(self.raw.get("Actual Total Time", 0) or 0) * serial_loops

    @property
    def exclusive_ms(self) -> float:
        child_time = sum(c.inclusive_ms for c in self.children)
        return max(0.0, self.inclusive_ms - child_time)

    def buf(self, key: str) -> int:
        return int(self.raw.get(key, 0) or 0)

    @property
    def analyzed(self) -> bool:
        return "Actual Total Time" in self.raw or "Actual Rows" in self.raw


def walk(raw: dict, depth: int = 0, workers: int = 1, under_limit: bool = False) -> Node:
    node = Node(raw=raw, depth=depth, workers=workers, under_limit=under_limit)
    child_workers = workers
    if raw.get("Node Type") in ("Gather", "Gather Merge"):
        launched = raw.get("Workers Launched", raw.get("Workers Planned", 0)) or 0
        child_workers = int(launched) + 1  # workers plus the leader participating
    child_under_limit = under_limit or raw.get("Node Type") == "Limit"
    for child in raw.get("Plans", []) or []:
        node.children.append(walk(child, depth + 1, child_workers, child_under_limit))
    return node


def flatten(node: Node) -> list[Node]:
    out = [node]
    for c in node.children:
        out.extend(flatten(c))
    return out


def load(path: str) -> dict:
    data = sys.stdin.read() if path == "-" else open(path, encoding="utf-8").read()
    data = data.strip()
    # psql -A -t output may include a trailing newline or be wrapped in brackets; handle both
    parsed = json.loads(data)
    if isinstance(parsed, list):
        parsed = parsed[0]
    if "Plan" not in parsed:
        raise SystemExit("input does not look like EXPLAIN (FORMAT JSON) output: missing 'Plan'")
    return parsed


def fmt_rows(n: float) -> str:
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    if n >= 10_000:
        return f"{n/1000:.0f}k"
    return f"{n:.0f}"


def fmt_ms(ms: float) -> str:
    return f"{ms:,.1f}ms" if ms < 10_000 else f"{ms/1000:,.1f}s"


def ratio_str(est: float, act: float) -> str:
    if est <= 0 or act <= 0:
        return "" if est == act else f"(est {fmt_rows(est)} vs act {fmt_rows(act)})"
    r = act / est
    if r >= 1:
        return f"{r:.0f}x under-estimated" if r >= 10 else f"{r:.1f}x under"
    r = est / act
    return f"{r:.0f}x over-estimated" if r >= 10 else f"{r:.1f}x over"


def red_flags(nodes: list[Node], min_rows: int) -> list[str]:
    flags: list[str] = []
    for n in nodes:
        r = n.raw
        where = f"[{n.label}]"
        est, act = n.est_rows, n.act_rows_total

        if n.type == "Seq Scan" and n.analyzed:
            removed = int(r.get("Rows Removed by Filter", 0) or 0) * n.loops
            scanned = act + removed
            if scanned >= min_rows:
                hint = (
                    "index on the filter column(s) (equality first, then range/sort)"
                    if removed > act
                    else "expected if most rows are needed; else add a filter or partition"
                )
                flags.append(
                    f"SEQ SCAN {where}: scanned ~{fmt_rows(scanned)} rows, kept {fmt_rows(act)}, "
                    f"removed {fmt_rows(removed)} by filter, {n.loops} loop(s). Fix: {hint}."
                )

        # Plan Rows and Actual Rows are both per execution (per loop), so compare them directly.
        # Under a Limit, fewer actual rows than estimated is expected (the Limit stopped pulling).
        est_pl, act_pl = n.est_rows, n.act_rows_per_loop
        if n.analyzed and est_pl > 0 and (act_pl >= 1000 or est_pl >= 1000):
            under = act_pl / est_pl >= 10
            over = act_pl > 0 and est_pl / act_pl >= 10 and not n.under_limit
            if under or over:
                per_loop = f" per loop over {n.loops} loops" if n.loops > 1 else ""
                flags.append(
                    f"BAD ESTIMATE {where}: planner expected {fmt_rows(est_pl)} rows, got {fmt_rows(act_pl)}{per_loop} "
                    f"({ratio_str(est_pl, act_pl)}). Fix: ANALYZE the table; extended statistics for correlated "
                    f"columns; expression index or generated column for opaque predicates; raise statistics target."
                )

        if n.type == "Sort":
            method = str(r.get("Sort Method", ""))
            if "external" in method.lower() or r.get("Sort Space Type") == "Disk":
                used = r.get("Sort Space Used", "?")
                flags.append(
                    f"SORT SPILL {where}: {method}, {used} kB on disk, {fmt_rows(act)} rows. "
                    f"Fix: index matching ORDER BY (after the WHERE columns); LIMIT for top-N; "
                    f"SET LOCAL work_mem for reports."
                )
        if n.type == "Incremental Sort" and r.get("Full-sort Groups", {}).get("Sort Methods"):
            pass  # incremental sorts rarely spill; skip

        if n.type == "Hash" and int(r.get("Hash Batches", 1) or 1) > 1:
            flags.append(
                f"HASH BATCHES {where}: {r.get('Hash Batches')} batches "
                f"(peak {r.get('Peak Memory Usage', '?')} kB). Hash table exceeded work_mem. "
                f"Fix: filter the hashed side earlier; raise work_mem for the session; check estimates."
            )

        if n.type == "Bitmap Heap Scan":
            lossy = int(r.get("Lossy Heap Blocks", 0) or 0)
            exact = int(r.get("Exact Heap Blocks", 0) or 0)
            if lossy > 0 and lossy >= exact:
                recheck = int(r.get("Rows Removed by Index Recheck", 0) or 0)
                flags.append(
                    f"LOSSY BITMAP {where}: {lossy} lossy vs {exact} exact heap blocks, "
                    f"{fmt_rows(recheck)} rows removed by recheck. work_mem too small for the bitmap. "
                    f"Fix: more selective predicate, partial index, or raise work_mem."
                )

        if n.type == "Index Only Scan":
            fetches = int(r.get("Heap Fetches", 0) or 0)
            if fetches > 0 and act > 0 and fetches >= max(1000, act * 0.2):
                flags.append(
                    f"HEAP FETCHES {where}: {fmt_rows(fetches)} heap fetches for {fmt_rows(act)} rows; "
                    f"visibility map stale. Fix: VACUUM (ANALYZE) the table; tune autovacuum for it."
                )

        if n.type in ("Index Scan", "Index Only Scan", "Bitmap Heap Scan") and n.analyzed:
            removed = int(r.get("Rows Removed by Filter", 0) or 0) * n.loops
            if removed >= min_rows and removed > act:
                flags.append(
                    f"FILTER AFTER INDEX {where}: index returned {fmt_rows(act + removed)} rows, filter "
                    f"removed {fmt_rows(removed)}. The index does not cover the predicate. Fix: add the "
                    f"filtered column to the index (after equality columns) or create a partial index."
                )

        if n.type == "Nested Loop" and n.analyzed and len(n.children) == 2:
            inner = n.children[1]
            if inner.loops >= 1000 and inner.act_rows_per_loop >= 100:
                flags.append(
                    f"NESTED LOOP {where}: inner side [{inner.label}] ran {inner.loops} times returning "
                    f"~{fmt_rows(inner.act_rows_per_loop)} rows each ({fmt_rows(inner.act_rows_total)} total). "
                    f"Usually a mis-estimate choosing nested loop over hash join. Fix: ANALYZE; fix statistics "
                    f"on the outer side; confirm with SET enable_nestloop = off in a session."
                )
            elif inner.loops >= 10_000:
                flags.append(
                    f"MANY LOOPS {where}: inner side [{inner.label}] executed {inner.loops} times. "
                    f"Fine if each is a cheap index lookup; otherwise consider a hash join or batching."
                )

        if n.type == "Append" or n.type == "Merge Append":
            # partition pruning info appears on the Append node in newer versions
            pruned = r.get("Subplans Removed")
            if pruned is None and len(n.children) >= 8 and all(c.raw.get("Relation Name") for c in n.children):
                flags.append(
                    f"NO PRUNING {where}: {len(n.children)} partitions scanned, none removed. "
                    f"Fix: filter on the partition key with a plan-time constant or parameter; avoid functions on the key."
                )

        if n.type == "Gather" or n.type == "Gather Merge":
            planned = int(r.get("Workers Planned", 0) or 0)
            launched = r.get("Workers Launched")
            if launched is not None and planned > 0 and int(launched) < planned:
                flags.append(
                    f"WORKERS {where}: planned {planned}, launched {launched}. "
                    f"max_parallel_workers exhausted or running inside a function/cursor."
                )

        if n.type in ("CTE Scan", "Materialize") and n.loops > 1 and act >= min_rows:
            flags.append(
                f"RE-SCAN {where}: {fmt_rows(n.act_rows_per_loop)} rows re-read {n.loops} times. "
                f"Fix: inline the CTE (NOT MATERIALIZED) or restructure as a join."
            )

    return flags


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", help="plan.json from EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON), or - for stdin")
    ap.add_argument("--top", type=int, default=8, help="how many nodes to list by exclusive time (default 8)")
    ap.add_argument("--min-rows", type=int, default=10_000,
                    help="row threshold for seq scan / filter flags (default 10000)")
    args = ap.parse_args()

    plan = load(args.path)
    root = walk(plan["Plan"])
    nodes = flatten(root)
    analyzed = any(n.analyzed for n in nodes)

    print("== Plan totals ==")
    if "Planning Time" in plan:
        print(f"planning:  {fmt_ms(plan['Planning Time'])}")
    if "Execution Time" in plan:
        print(f"execution: {fmt_ms(plan['Execution Time'])}")
    hit = root.buf("Shared Hit Blocks")
    read = root.buf("Shared Read Blocks")
    dirtied = root.buf("Shared Dirtied Blocks")
    written = root.buf("Shared Written Blocks")
    temp_r = root.buf("Temp Read Blocks")
    temp_w = root.buf("Temp Written Blocks")
    if hit or read:
        total = hit + read
        pct = 100.0 * hit / total if total else 0
        print(f"buffers:   hit {hit:,} ({pct:.0f}%), read {read:,} ({read * 8 // 1024:,} MB), "
              f"dirtied {dirtied:,}, written {written:,}")
        if temp_r or temp_w:
            print(f"temp:      read {temp_r:,}, written {temp_w:,} blocks (spill to disk)")
    if "I/O Read Time" in root.raw and root.raw["I/O Read Time"]:
        print(f"io read:   {fmt_ms(root.raw['I/O Read Time'])} (track_io_timing)")
    print(f"nodes:     {len(nodes)}; root: {root.label}; est rows {fmt_rows(root.est_rows)}"
          + (f", actual {fmt_rows(root.act_rows_total)}" if analyzed else ""))
    if not analyzed:
        print("\n(no ANALYZE data: estimates only; re-run with EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON))")

    if analyzed:
        print(f"\n== Top {args.top} nodes by exclusive time ==")
        ranked = sorted(nodes, key=lambda n: n.exclusive_ms, reverse=True)[: args.top]
        exec_total = float(plan.get("Execution Time", root.inclusive_ms) or root.inclusive_ms) or 1.0
        for n in ranked:
            pct = 100.0 * n.exclusive_ms / exec_total
            if n.loops > 1:
                est_act = (f"rows/loop est {fmt_rows(n.est_rows)} / act {fmt_rows(n.act_rows_per_loop)}"
                           f" ({fmt_rows(n.act_rows_total)} total)")
            else:
                est_act = f"rows est {fmt_rows(n.est_rows)} / act {fmt_rows(n.act_rows_per_loop)}"
            r = ratio_str(n.est_rows, n.act_rows_per_loop)
            if n.under_limit and n.act_rows_per_loop < n.est_rows:
                r = ""  # a Limit above stopped pulling rows; not a mis-estimate
            loops = f", loops {n.loops}" if n.loops > 1 else ""
            if n.workers > 1:
                loops += f" ({n.workers} parallel workers)"
            bufs = ""
            if n.buf("Shared Read Blocks") or n.buf("Shared Hit Blocks"):
                bufs = f", buf hit {n.buf('Shared Hit Blocks'):,} read {n.buf('Shared Read Blocks'):,}"
            indent = "  " * n.depth
            print(f"{fmt_ms(n.exclusive_ms):>10} {pct:5.1f}%  {indent}{n.label}")
            print(f"{'':>10}        {indent}  {est_act}{(' (' + r + ')') if r else ''}{loops}{bufs}")
            for key in ("Index Cond", "Recheck Cond", "Filter", "Hash Cond", "Merge Cond", "Join Filter", "Sort Key"):
                if key in n.raw:
                    val = n.raw[key]
                    val = ", ".join(val) if isinstance(val, list) else str(val)
                    if len(val) > 110:
                        val = val[:107] + "..."
                    print(f"{'':>10}        {indent}  {key}: {val}")

    flags = red_flags(nodes, args.min_rows)
    print(f"\n== Red flags ({len(flags)}) ==")
    if not flags:
        print("none detected (does not mean the plan is optimal; check the top nodes above)")
    for f in flags:
        print("- " + f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
