#!/usr/bin/env python3
"""Terminal player for Cento animations (24-bit colour, half-block pixels).
   python3 play.py --list        list animations by category
   python3 play.py typing        loop one animation (Ctrl-C to stop)
   python3 play.py typing -n 3   play it 3 times
   python3 play.py typing --color red      violet|red|yellow|green|brown
   python3 play.py --tour [category]       play everything once, one after another (Ctrl-C to quit)"""
import json, os, sys, time

DATA = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'animations.json')))
PAL = {k: tuple(int(v[i:i+2], 16) for i in (1, 3, 5)) for k, v in DATA['palette'].items()}
ANIMS = {a['name']: a for a in DATA['animations']}


def recolor(color):
    me, fr = DATA['palmap'][color], DATA['palmap'][DATA['colors'][(DATA['colors'].index(color) + 1) % len(DATA['colors'])]]
    m = {c: me[c] for c in 'BDHS'}
    m.update({'1': fr['B'], '2': fr['D'], '3': fr['H']})
    return lambda ch: m.get(ch, ch)


def render(rows, rc=lambda ch: ch):
    rows = [''.join(rc(c) for c in r) for r in rows]
    rows = list(rows) + (['.' * len(rows[0])] if len(rows) % 2 else [])
    out = []
    for y in range(0, len(rows), 2):
        line = ''
        for t, b in zip(rows[y], rows[y + 1]):
            tc, bc = PAL.get(t), PAL.get(b)
            if tc and bc: line += '\x1b[38;2;%d;%d;%d;48;2;%d;%d;%dm▀\x1b[0m' % (tc + bc)
            elif tc:      line += '\x1b[38;2;%d;%d;%dm▀\x1b[0m' % tc
            elif bc:      line += '\x1b[38;2;%d;%d;%dm▄\x1b[0m' % bc
            else:         line += ' '
        out.append(line)
    return out


def main():
    args = sys.argv[1:]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__); return
    if args[0] == '--list':
        cats = {}
        for a in DATA['animations']:
            cats.setdefault(a['cat'], []).append(a['name'])
        for c, names in cats.items():
            print('%s (%d): %s' % (c, len(names), ', '.join(names)))
        return
    color = args[args.index('--color') + 1] if '--color' in args else 'violet'
    rc = recolor(color)
    if args[0] == '--tour':
        cat = args[1] if len(args) > 1 and not args[1].startswith('-') else None
        names = [a['name'] for a in DATA['animations'] if cat in (None, a['cat'])]
        sys.stdout.write('\x1b[?25l')
        try:
            for n in names:
                a = ANIMS[n]
                sys.stdout.write('\x1b[2J\x1b[H%s  (%s)  %s\n\n' % (n, a['cat'], a['desc']))
                h = (a['h'] + 1) // 2
                sys.stdout.write('\n' * h)
                end = time.time() + max(2.5, sum(f['d'] for f in a['frames']) / 1000)
                while time.time() < end:
                    for fr in a['frames']:
                        sys.stdout.write('\x1b[%dA' % h + '\n'.join(render(fr['rows'], rc)) + '\n')
                        sys.stdout.flush()
                        time.sleep(fr['d'] / 1000)
        except KeyboardInterrupt:
            pass
        finally:
            sys.stdout.write('\x1b[?25h\n')
        return
    a = ANIMS.get(args[0])
    if not a:
        sys.exit('unknown animation: ' + args[0])
    loops = int(args[args.index('-n') + 1]) if '-n' in args else 0
    n, h = 0, (a['h'] + 1) // 2
    sys.stdout.write('\x1b[?25l' + '\n' * h)
    try:
        while True:
            for fr in a['frames']:
                sys.stdout.write('\x1b[%dA' % h + '\n'.join(render(fr['rows'], rc)) + '\n')
                sys.stdout.flush()
                time.sleep(fr['d'] / 1000)
            n += 1
            if loops and n >= loops:
                break
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write('\x1b[?25h')


if __name__ == '__main__':
    main()
