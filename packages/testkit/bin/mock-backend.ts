#!/usr/bin/env node
/** CLI entrypoint for the mock backend. Prints exactly one JSON line `{"http","ws"}` on stdout when ready; everything
 *  else (events, errors) goes to stderr. Exit codes: 0 after SIGINT/SIGTERM, 1 port in use or startup failure, 2 bad
 *  arguments, scenario file or seed data. */
import { DEFAULT_RELAY_OPTIONS, MockInputError, startMockBackend, type MockOptions } from '../src/mock-backend/index.js';

const USAGE = `centcom-mock-backend [--port N|0] [--scenario NAME|FILE.json] [--seed N] [--data DIR] [--clock real|virtual]
                     [--ping-ms N] [--dead-ms N] [--no-control] [--quiet]
Prints one JSON line {"http","ws"} on stdout when ready; logs JSON lines to stderr (--quiet: errors only).
Exit codes: 0 after SIGINT/SIGTERM, 1 port in use or startup failure, 2 bad arguments, scenario or seed data.
`;
const VALUED = new Set(['--port', '--scenario', '--seed', '--data', '--clock', '--ping-ms', '--dead-ms']);
const FLAGS = new Set(['--no-control', '--quiet', '--help']);

function parse(argv: string[]): { o: MockOptions; quiet: boolean } | string {
  const v = new Map<string, string>(); const f = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (FLAGS.has(a)) { f.add(a); continue; }
    if (!VALUED.has(a)) return `unknown argument ${a}`;
    const val = argv[++i]; if (val === undefined || val.startsWith('--')) return `${a} needs a value`; v.set(a, val);
  }
  if (f.has('--help')) return '';
  const int = (name: string, min: number, max: number): number | undefined | string => {
    const s = v.get(name); if (s === undefined) return undefined; const n = Number(s);
    return Number.isInteger(n) && n >= min && n <= max ? n : `${name} must be an integer from ${min} to ${max}`;
  };
  const port = int('--port', 0, 65_535); const seed = int('--seed', 0, 4_294_967_295); const ping = int('--ping-ms', 100, 600_000); const dead = int('--dead-ms', 100, 3_600_000);
  for (const x of [port, seed, ping, dead]) if (typeof x === 'string') return x;
  const clock = v.get('--clock') ?? 'real'; if (clock !== 'real' && clock !== 'virtual') return '--clock must be real or virtual';
  const heartbeat = ping !== undefined || dead !== undefined ? { ping_ms: (ping as number | undefined) ?? DEFAULT_RELAY_OPTIONS.ping_ms, dead_ms: (dead as number | undefined) ?? DEFAULT_RELAY_OPTIONS.dead_ms } : undefined;
  if (heartbeat && heartbeat.dead_ms <= heartbeat.ping_ms) return '--dead-ms must be larger than --ping-ms';
  const quiet = f.has('--quiet');
  const log = (e: Record<string, unknown>) => { if (!quiet || e.event === 'relay_error') process.stderr.write(JSON.stringify(e) + '\n'); };
  return {
    quiet,
    o: { port: (port as number | undefined) ?? 0, seed: seed as number | undefined, clock, scenario: v.get('--scenario'), dataDir: v.get('--data'), heartbeat, control: !f.has('--no-control'), log },
  };
}

const parsed = parse(process.argv.slice(2));
if (typeof parsed === 'string') {
  if (parsed === '') { process.stdout.write(USAGE); process.exit(0); }
  process.stderr.write(`${parsed}\n${USAGE}`); process.exit(2);
}

let mock: Awaited<ReturnType<typeof startMockBackend>>;
try {
  mock = await startMockBackend(parsed.o);
} catch (e) {
  const err = e as Error & { code?: string };
  process.stderr.write(`${err.message}\n`);
  process.exit(err instanceof MockInputError || /^unknown scenario/.test(err.message) ? 2 : 1);
}
let stopping = false;
const stop = (signal: string) => {
  if (stopping) return; stopping = true;
  /* the 1001 handshakes are given 250 ms inside stop(); this is the hard backstop for the 1 s exit promise */
  setTimeout(() => process.exit(0), 900).unref();
  void mock.stop().then(() => { if (!parsed.quiet) process.stderr.write(JSON.stringify({ event: 'exit', signal }) + '\n'); process.exit(0); }, () => process.exit(1));
};
process.on('SIGINT', () => stop('SIGINT')); process.on('SIGTERM', () => stop('SIGTERM'));
/* only announce readiness once the signal handlers are in place, so a caller may signal as soon as it reads the line */
process.stdout.write(JSON.stringify({ http: mock.httpUrl, ws: mock.wsUrl }) + '\n');
if (!parsed.quiet) process.stderr.write(JSON.stringify({ event: 'ready', http: mock.httpUrl, seed: mock.seed, clock: mock.clock.kind }) + '\n');
