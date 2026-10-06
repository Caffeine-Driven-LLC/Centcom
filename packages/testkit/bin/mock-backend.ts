#!/usr/bin/env node
import { startMockBackend } from '../src/mock-backend/index.js';
const a = process.argv.slice(2); const val = (n: string) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
if (a.includes('--help')) { process.stdout.write('centcom-mock-backend [--port N|0] [--seed N] [--clock real|virtual] [--scenario NAME] [--no-control]\nPrints one JSON line {url, ws_url, port, seed} when ready.\n'); process.exit(0); }
const mock = await startMockBackend({ port: Number(val('--port') ?? 0), seed: Number(val('--seed') ?? 1), clock: (val('--clock') as 'real' | 'virtual') ?? 'real', scenario: val('--scenario'), control: !a.includes('--no-control') });
process.stdout.write(JSON.stringify({ url: mock.url, ws_url: mock.wsUrl, port: Number(new URL(mock.url).port), seed: Number(val('--seed') ?? 1) }) + '\n');
const stop = () => void mock.stop().then(() => process.exit(0)); process.on('SIGINT', stop); process.on('SIGTERM', stop);
