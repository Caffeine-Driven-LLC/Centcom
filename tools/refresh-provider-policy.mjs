#!/usr/bin/env node
/** Refreshes `checked_at` in packages/agent/data/provider-policy.json each release and checks the rows still equal the reference table in contracts/fixtures/providers/policy-reference.json. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ref = JSON.parse(readFileSync(`${root}contracts/fixtures/providers/policy-reference.json`, 'utf8')).data;
const file = `${root}packages/agent/data/provider-policy.json`;
const next = { ...ref, checked_at: new Date().toISOString() };
if (process.argv.includes('--check')) { const cur = JSON.parse(readFileSync(file, 'utf8')); if (JSON.stringify(cur.methods) !== JSON.stringify(ref.methods)) { console.error('provider-policy.json differs from the reference rows; run tools/refresh-provider-policy.mjs'); process.exit(1); } console.log('provider policy rows match the reference'); process.exit(0); }
writeFileSync(file, JSON.stringify(next, null, 2) + '\n'); console.log(`provider-policy.json refreshed (${next.methods.length} methods, ${next.checked_at})`);
