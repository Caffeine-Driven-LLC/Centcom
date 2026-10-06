#!/usr/bin/env node
/* A change to tools/bench/baseline.json must say why: the commit message needs a line starting "Baseline:". `node check-baseline-commit.mjs <base-ref>` looks at the commits since that ref. */
import { execFileSync } from 'node:child_process';
const base = process.argv[2] ?? 'origin/main'; const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const commits = git('log', '--format=%H', `${base}..HEAD`, '--', 'tools/bench/baseline.json').split('\n').filter(Boolean); let bad = 0;
for (const c of commits) if (!/^Baseline: .{8,}/m.test(git('log', '-1', '--format=%B', c))) { console.error(`Commit ${c.slice(0, 8)} changes the benchmark baseline without a "Baseline: <reason>" line.`); bad++; }
process.exit(bad ? 1 : 0);
