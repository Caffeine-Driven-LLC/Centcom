import { describe, expect, it } from 'vitest';
import { parseShell } from '../../src/sandbox/index.js';

const words = (c: string) => parseShell(c).segments.map((s) => s.words);
describe('shell reader', () => {
  it('splits on ; && || | & and newlines', () => { expect(words('a; b && c || d | e & f\ng')).toEqual([['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g']]); });
  it('keeps operators that sit inside quotes', () => { expect(words(String.raw`echo "a && b" 'c; d' e\;f`)).toEqual([['echo', 'a && b', 'c; d', 'e;f']]); });
  it('marks pipes', () => { const s = parseShell('a | b').segments; expect(s[0]!.pipedTo).toBe(true); expect(s[1]!.pipedFrom).toBe(true); });
  it('separates env prefixes and redirections', () => { const s = parseShell('FOO=1 BAR="x y" cmd a > out 2>&1 < in').segments[0]!; expect(s.env).toEqual(['FOO', 'BAR']); expect(s.words).toEqual(['cmd', 'a']); expect(s.redirects).toEqual([{ op: '>', target: 'out' }, { op: '<', target: 'in' }]); });
  it('finds $(...), backticks, process substitution (nested, quoted)', () => { expect(parseShell('echo $(a $(b) ")") `c`').segments[0]!.subs).toEqual(['a $(b) ")"', 'c']); expect(parseShell('cat <(x) >(y)').segments[0]!.subs).toEqual(['x', 'y']); expect(parseShell('echo "x $(y)"').segments[0]!.subs).toEqual(['y']); expect(parseShell("echo '$(y)'").segments[0]!.subs).toEqual([]); });
  it('reads heredocs: the body is not a command, substitutions in an unquoted body are', () => { const p = parseShell('cat <<EOF\nrm -rf /\n$(whoami)\nEOF\nls'); expect(p.ok).toBe(true); expect(p.segments.map((s) => s.words)).toEqual([['cat'], ['ls']]); expect(p.segments[0]!.subs).toEqual(['whoami']); expect(parseShell("cat <<'EOF'\n$(whoami)\nEOF").segments[0]!.subs).toEqual([]); });
  it('fails closed on what it cannot read', () => { for (const c of ["echo 'a", 'echo "a', 'echo $(a', 'echo `a', 'cat <<EOF\nx', 'ls <(', 'a \\', 'x\0y', 'x\ufffdy', 'x\ud800y']) expect(parseShell(c).ok, c).toBe(false); });
  it('refuses a fork bomb, an over-long command and depth beyond 4', () => { expect(parseShell(':(){ :|:& };:').ok).toBe(false); expect(parseShell('a'.repeat(70_000)).reason).toBe('too_long'); expect(parseShell('ls', 5).reason).toBe('too_deep'); });
  it('flags a command word that comes from an expansion', () => { expect(parseShell('$CMD x').segments[0]!.dynamicCommand).toBe(true); expect(parseShell('echo $X').segments[0]!.dynamicCommand).toBe(false); });
});
