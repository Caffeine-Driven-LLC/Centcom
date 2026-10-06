#!/usr/bin/env node
/* `pnpm dev:mock [-- --scenario x --port n --seed n]`: starts the mock backend with the seed data in dev/seed and prints what a dev build of the client needs. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const argv = process.argv.slice(2); const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
if (argv.includes('--help')) { console.log('Usage: pnpm dev:mock [-- --scenario <name> --port <n> --seed <n>]'); process.exit(0); }
const args = ['--import', 'tsx', 'packages/testkit/bin/mock-backend.ts', '--data', 'dev/seed', '--scenario', val('--scenario', 'happy'), '--port', val('--port', '8787'), '--seed', val('--seed', '7'), '--quiet'];
const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
createInterface({ input: child.stdout }).once('line', (line) => {
  let u; try { u = JSON.parse(line); } catch { console.error('The mock said something unexpected: ' + line.slice(0, 200)); child.kill(); process.exit(1); }
  console.log(JSON.stringify({ http: u.http, ws: u.ws }));
  console.log(`\nThe mock backend is running (Ctrl+C stops it). Point a dev build of the client at it:\n\n  export CENTCOM_API_URL=${u.http}\n  export CENTCOM_RELAY_URL=${u.ws}\n  export CENTCOM_CONFIG_DIR=.dev/config\n  export CENTCOM_STATE_DIR=.dev/state\n\nThen: pnpm centcom login`);
});
