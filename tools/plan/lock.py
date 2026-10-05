#!/usr/bin/env python3
"""contracts/CONTRACTS.lock: sha256 of every file under contracts/ (except the lock itself).
  lock.py --write   regenerate (only in a Contract PR)
  lock.py --check   verify (CI, every lane)
  lock.py --compare <other-repo>/contracts   verify two repos hold identical contracts"""
import hashlib, os, sys
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
def digest(base):
    out = {}
    for dp, dn, fns in os.walk(base):
        dn[:] = sorted(d for d in dn if d != '__pycache__')
        for fn in sorted(fns):
            if fn in ('CONTRACTS.lock', '.DS_Store') or fn.endswith('.pyc'): continue
            p = os.path.join(dp, fn)
            out[os.path.relpath(p, base).replace(os.sep, '/')] = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    return out
def render(d): return ''.join(f'{h}  {p}\n' for p, h in sorted(d.items()))
if __name__ == '__main__':
    base = os.path.join(ROOT, 'contracts'); lock = os.path.join(base, 'CONTRACTS.lock')
    mode = sys.argv[1] if len(sys.argv) > 1 else '--check'
    if mode == '--write':
        open(lock, 'w').write(render(digest(base))); print('wrote', lock)
    elif mode == '--check':
        want = open(lock).read() if os.path.exists(lock) else ''
        got = render(digest(base))
        if want != got:
            a = dict(l.split('  ', 1)[::-1] for l in want.splitlines()); b = dict(l.split('  ', 1)[::-1] for l in got.splitlines())
            for p in sorted(set(a) | set(b)):
                if a.get(p) != b.get(p): print('DRIFT', p)
            print('contracts/ differs from CONTRACTS.lock (use the Contract PR process)'); sys.exit(1)
        print('contracts lock OK', len(got.splitlines()), 'files')
    elif mode == '--compare':
        other = os.path.abspath(sys.argv[2])
        a, b = digest(base), digest(other)
        diff = [p for p in sorted(set(a) | set(b)) if a.get(p) != b.get(p)]
        for p in diff: print('DIFF', p)
        print('identical' if not diff else f'{len(diff)} differences'); sys.exit(1 if diff else 0)
