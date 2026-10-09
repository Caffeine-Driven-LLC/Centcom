import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkArgs, normalizeArgs, specsOf } from '../src/flags.js';
import { COMMANDS } from '../src/help/commands.js';

const top = COMMANDS.find((c) => c.name === 'centcom')!.flags; const names = [...COMMANDS.map((c) => c.name).filter((n) => n !== 'centcom'), 'help'];
const check = (args: string[], print = false) => checkArgs(normalizeArgs(args, top), top, { print, commands: names });

describe('the command line is checked against the documented options', () => {
  it.each([
    [[], undefined], [['--demo'], undefined], [['--demo', '--theme', 'hc', '--mascot', 'off'], undefined], [['--theme=light'], undefined], [['-c'], undefined], [['--resume', 'ses_1'], undefined], [['--yolo'], undefined], [['--screen-reader', '--no-motion'], undefined], [['--model', 'claude-opus-5-5'], undefined], [['--resume'], undefined], [['--resume', '--demo'], undefined], [['--theme', 'auto'], undefined], [['--mascot', 'auto'], undefined], [['--colors', 'auto'], undefined], [['-p', 'x', '--permission-mode', 'acceptEdits'], undefined], [['-p', 'x', '--permission-mode', 'default'], undefined],
    [['-p', 'fix the bug'], undefined], [['-p'], undefined], [['-p', 'task', '--allow', 'Bash(npm test)', '--allow', 'Edit', '--max-turns', '5', '--timeout', '60', '--cwd', '/tmp', '--permission-mode', 'accept-edits'], undefined], [['--output-format', 'stream-json', '-p', 'x'], undefined],
  ] as [string[], string | undefined][])('%j is fine', (args, want) => { expect(check(args, args.includes('-p'))).toBe(want); });

  it('an unknown option names it and suggests the closest real one', () => {
    expect(check(['--bogus'])).toBe('Unknown option --bogus. Try `centcom --help`.'); expect(check(['--demo-tean'])).toBe('Unknown option --demo-tean. Did you mean --demo-team? Try `centcom --help`.'); expect(check(['--screen-reeder'])).toContain('Did you mean --screen-reader?'); expect(check(['--themee', 'dark'])).toContain('Did you mean --theme?');
  });
  it('a value that is not allowed lists what is, and a missing value says so', () => {
    expect(check(['--theme', 'purple'])).toBe('--theme must be one of auto, dark, light, hc (you typed "purple").'); expect(check(['--mode', 'nonsense'])).toMatch(/--mode must be one of default, plan, acceptEdits, bypassPermissions/); expect(check(['--engine', 'gpt'])).toMatch(/claude-code, codex, demo/);
    expect(check(['--model'])).toBe('--model needs a value.'); expect(check(['--theme'])).toBe('--theme needs a value (auto, dark, light, hc).'); expect(check(['--model', '--demo'])).toBe('--model needs a value.'); expect(check(['--theme=purple'])).toContain('must be one of');
  });
  it('a stray word in the terminal app is a mistyped command (with a suggestion); in print mode words are the task', () => {
    expect(check(['doctr'])).toBe('Unknown command "doctr". Did you mean `centcom doctor`? Try `centcom --help`.'); expect(check(['hello'])).toBe('Unknown command "hello". Try `centcom --help`.');
    expect(check(['-p', 'hello', 'world'], true)).toBeUndefined(); expect(check(['-p', '--', '--not-a-flag'], true)).toBeUndefined();
  });
  it('--flag=value is split only for options that take a value', () => { expect(normalizeArgs(['--theme=light', '--demo=1', '-p', 'a=b'], top)).toEqual(['--theme', 'light', '--demo=1', '-p', 'a=b']); expect(check(['--demo=1'])).toContain('Unknown option --demo=1'); });
  it('every option the app reads is documented, so nothing real is ever rejected', () => {
    const documented = new Set(top.flatMap((f) => f.flag.split(',').map((s) => s.trim()))); for (const f of ['--allow', '--cwd', '--max-turns', '--permission-mode', '--timeout', '--yolo', '--screen-reader', '--dangerously-skip-permissions']) expect(documented.has(f)).toBe(true);
  });
});

describe('centcom with a bad command line (the real launcher)', () => {
  const bin = resolve(__dirname, '../../../bin/centcom');
  const run = (args: string[]) => spawnSync(bin, args, { encoding: 'utf8', timeout: 30_000 });
  it('prints one line to stderr and exits 2, before any screen or agent starts', () => {
    for (const [args, msg] of [[['--bogus'], 'Unknown option --bogus'], [['--theme', 'purple'], '--theme must be one of'], [['doctr'], 'Did you mean `centcom doctor`?'], [['--demo', '--model'], '--model needs a value']] as [string[], string][]) {
      const r = run(args); expect(r.status).toBe(2); expect(r.stderr.trim().split('\n')).toHaveLength(1); expect(r.stderr).toContain(msg); expect(r.stdout).toBe('');
    }
  }, 60_000);
  it('still prints the version and the help, and a real subcommand still runs', () => {
    expect(run(['--version']).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/); expect(run(['--help']).stdout).toContain('--screen-reader'); expect(run(['keys']).status).toBe(0);
  }, 60_000);
});
void execFileSync;

describe('the allowed values of an option match what the settings accept', () => {
  it.each([['--theme', 'ui.theme', []], ['--mascot', 'client.mascot_size', []], ['--colors', 'ui.color', []], ['--cento-color', 'client.cento_color', []], ['--mode', 'client.permission_mode', ['bypassPermissions']], ['--engine', 'client.engine', ['demo']]] as [string, string, string[]][])('%s accepts every value of %s', async (flag, key, extra) => {
    const { SCHEMA } = await import('@centcom/config'); const spec = (SCHEMA as Record<string, { enum?: readonly string[] }>)[key]!; const allowed = new Set(top.find((f) => f.flag.split(',').map((s) => s.trim()).includes(flag))!.arg!.replace(/[<>]/g, '').split('|'));
    for (const v of [...(spec.enum ?? []), ...extra]) expect(allowed.has(v), `${flag} should accept "${v}"`).toBe(true);
    for (const v of allowed) expect([...(spec.enum ?? []), ...extra].includes(v), `${flag} lists "${v}" but the settings do not accept it`).toBe(true);
  });
});

describe('option validation as a property of the help list', () => {
  const specs = specsOf(top);
  const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const valid = (r: () => number): string[] => { const out: string[] = []; for (const s of specs.filter((x) => !x.names.includes('-h') && !x.names.includes('-v'))) if (r() < 0.4) { const name = s.names[Math.floor(r() * s.names.length)]!; out.push(name); if (s.takes !== 'none' && (s.takes === 'required' || r() < 0.5)) out.push(s.allowed ? s.allowed[Math.floor(r() * s.allowed.length)]! : ['x', 'a b', '12', 'path/to'][Math.floor(r() * 4)]!); } return out; };
  it('300 random valid combinations of the documented options are all accepted (alone, or as the options of -p)', () => {
    const r = rng(7); for (let i = 0; i < 300; i++) { const args = valid(r); const print = args.includes('-p') || args.includes('--print'); expect(check(args, print), JSON.stringify(args)).toBeUndefined(); }
  });
  it('a one-letter typo in any option is rejected, and the right option is suggested whenever it is close', () => {
    for (const s of specs) for (const name of s.names.filter((n) => n.startsWith('--') && n.length > 6)) {
      const typo = name.slice(0, 4) + name.slice(5); // one letter missing
      if (specs.some((x) => x.names.includes(typo))) continue; const msg = check([typo]); expect(msg, typo).toMatch(/^Unknown option /); expect(msg, typo).toContain(`Did you mean ${name}?`);
    }
  });
  it('an allowed value with one letter changed is rejected for every option that lists its values', () => {
    for (const s of specs.filter((x) => x.allowed)) for (const flag of s.names.filter((n) => n.startsWith('--'))) { const bad = s.allowed![0]! + 'zz'; expect(check([flag, bad]), `${flag} ${bad}`).toContain('must be one of'); }
  });
});
