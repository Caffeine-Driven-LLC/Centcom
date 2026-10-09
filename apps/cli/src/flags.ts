/** Checks the command line against the flag list the help and the docs are made from: an unknown option, a missing value or a value that is not allowed is one clear line, not a silent no-op. */
import type { Flag } from './help/commands.js';

interface Spec { names: string[]; takes: 'none' | 'optional' | 'required'; allowed?: string[] }
export function specsOf(flags: Flag[]): Spec[] {
  return flags.map((f) => {
    const names = f.flag.split(',').map((s) => s.trim()); const a = f.arg ?? ''; const allowed = /^<([^<>]*\|[^<>]*)>$/.exec(a)?.[1]?.split('|');
    return { names, takes: !a ? 'none' : a.startsWith('[') ? 'optional' : 'required', ...(allowed ? { allowed } : {}) };
  });
}
const distance = (a: string, b: string): number => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0]![j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length]![b.length]!; };

/** How different a word may be and still be offered as "did you mean": short words must be nearly identical. */
const close = (w: string) => Math.max(1, Math.floor(w.length / 4));

/** `--theme=light` becomes `--theme light`, so one parser reads both. Only long options with a known value-taking spec are split. */
export function normalizeArgs(argv: string[], flags: Flag[]): string[] {
  const takers = new Set(specsOf(flags).filter((s) => s.takes !== 'none').flatMap((s) => s.names.filter((n) => n.startsWith('--'))));
  return argv.flatMap((a) => { const m = /^(--[a-z][a-z-]*)=(.*)$/s.exec(a); return m && takers.has(m[1]!) ? [m[1]!, m[2]!] : [a]; });
}

/** `args` are the words after the program name. In the terminal app a stray word is a mistyped command; in print mode (`-p`) words are the task. */
export function checkArgs(args: string[], flags: Flag[], o: { print: boolean; commands: string[] }): string | undefined {
  const specs = specsOf(flags); const byName = new Map<string, Spec>(); for (const s of specs) for (const n of s.names) byName.set(n, s); const known = [...byName.keys()].filter((n) => n.startsWith('--'));
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') return undefined; // everything after is text
    if (!a.startsWith('-') || a === '-') {
      if (o.print) continue;
      const near = o.commands.filter((c) => distance(a, c) <= close(a))[0];
      return `Unknown command "${a}".${near ? ` Did you mean \`centcom ${near}\`?` : ''} Try \`centcom --help\`.`;
    }
    const s = byName.get(a);
    if (!s) { const near = known.filter((n) => distance(a, n) <= close(a)).sort((x, y) => distance(a, x) - distance(a, y))[0]; return `Unknown option ${a}.${near ? ` Did you mean ${near}?` : ''} Try \`centcom --help\`.`; }
    if (s.takes === 'none') continue;
    const next = args[i + 1]; const has = next !== undefined && (!next.startsWith('-') || /^-\d/.test(next));
    if (!has) { if (s.takes === 'required') return `${a} needs a value${s.allowed ? ` (${s.allowed.join(', ')})` : ''}.`; continue; }
    if (s.allowed && !s.allowed.includes(next!)) return `${a} must be one of ${s.allowed.join(', ')} (you typed "${next}").`;
    i++;
  }
  return undefined;
}
