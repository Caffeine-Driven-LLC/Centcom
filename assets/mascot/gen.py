#!/usr/bin/env python3
"""Generates Cento, the Centcom mascot: SVGs (per pose + sheet) and an ANSI terminal preview."""
import sys

PAL = {
    'B': '#7C5CFF', 'D': '#5A3FD1', 'H': '#A892FF', 'P': '#1B1530', 'M': '#1B1530',
    'S': '#5A3FD1', 'T': '#3DF2C8', 'W': '#D9D2FF', 'R': '#FF5C5C',
}
HEAD = [
    "............",
    "............",
    "..BBBBBBBB..",
    ".HBBBBBBBBB.",
    ".BBBBBBBBBB.",
    "BBBBBBBBBBBB",
    "BBBBBBBBBBBB",
    "BBBBBBBBBBBB",
    "BBBBBBBBBBBB",
    "DBBBBBBBBBBD",
]
LEGS = {
    'a': ["BB.BB..BB.BB", "B.BB....BB.B"],
    'b': ["BB.BB..BB.BB", ".B.BB..BB.B."],
}

def grid(pose, frame='a'):
    g = [list(r) for r in HEAD + LEGS[frame]]
    def put(r, c, ch): g[r][c] = ch
    g[0][5] = g[0][6] = 'T'
    g[1][5] = g[1][6] = 'S'
    if pose == 'idle':
        for c in (3, 8): put(6, c, 'P'); put(7, c, 'P')
        put(8, 5, 'M'); put(8, 6, 'M')
    elif pose == 'happy':
        for b in (2, 7): put(6, b+1, 'P'); put(7, b, 'P'); put(7, b+2, 'P')
        put(8, 5, 'M'); put(8, 6, 'M')
    elif pose == 'thinking':
        for c in (4, 9): put(5, c, 'P'); put(6, c, 'P')
        put(8, 6, 'M')
        put(2, 10, 'W'); put(1, 11, 'W')
    elif pose == 'working':
        for b in (2, 8): put(7, b, 'P'); put(7, b+1, 'P')
        put(8, 5, 'M'); put(8, 6, 'M')
        for r, c in ((0, 3), (1, 2), (0, 8), (1, 9)): put(r, c, 'T')
    elif pose == 'error':
        for b in (2, 7):
            for r, c in ((5, b), (5, b+2), (6, b+1), (7, b), (7, b+2)): put(r, c, 'P')
        put(8, 5, 'M'); put(8, 6, 'M')
        g[0][5] = g[0][6] = 'R'
    return g

def svg_body(g, s, ox=0, oy=0):
    out = []
    for y, row in enumerate(g):
        x = 0
        while x < len(row):
            ch = row[x]
            if ch == '.':
                x += 1; continue
            e = x
            while e < len(row) and row[e] == ch: e += 1
            out.append(f'<rect x="{ox+x*s}" y="{oy+y*s}" width="{(e-x)*s}" height="{s}" fill="{PAL[ch]}"/>')
            x = e
    return ''.join(out)

def svg(g, s=24):
    w, h = len(g[0])*s, len(g)*s
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'shape-rendering="crispEdges">{svg_body(g, s)}</svg>\n')

def ansi(g):
    def rgb(ch):
        if ch == '.': return None
        h = PAL[ch].lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    lines = []
    for y in range(0, len(g), 2):
        top, bot = g[y], g[y+1] if y+1 < len(g) else ['.']*len(g[0])
        s = ''
        for t, b in zip(top, bot):
            tc, bc = rgb(t), rgb(b)
            if tc and bc: s += f'\x1b[38;2;{tc[0]};{tc[1]};{tc[2]};48;2;{bc[0]};{bc[1]};{bc[2]}m▀\x1b[0m'
            elif tc: s += f'\x1b[38;2;{tc[0]};{tc[1]};{tc[2]}m▀\x1b[0m'
            elif bc: s += f'\x1b[38;2;{bc[0]};{bc[1]};{bc[2]}m▄\x1b[0m'
            else: s += ' '
        lines.append(s)
    return '\n'.join(lines)

POSES = ['idle', 'happy', 'thinking', 'working', 'error']
if __name__ == '__main__':
    for p in POSES:
        for f in 'ab':
            open(f'cento-{p}-{f}.svg', 'w').write(svg(grid(p, f)))
    s, cell, pad = 14, 12*14, 28
    W = len(POSES)*(cell+pad)+pad; H = 12*s+pad*2+28
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
             f'<rect width="{W}" height="{H}" fill="#13111F"/>']
    for i, p in enumerate(POSES):
        ox = pad + i*(cell+pad)
        parts.append(f'<g shape-rendering="crispEdges">{svg_body(grid(p), s, ox, pad)}</g>')
        parts.append(f'<text x="{ox+cell/2}" y="{pad+12*s+26}" fill="#D9D2FF" font-family="monospace" font-size="14" text-anchor="middle">{p}</text>')
    parts.append('</svg>\n')
    open('cento-sheet.svg', 'w').write(''.join(parts))
    if '--ansi' in sys.argv:
        for p in POSES: print(p); print(ansi(grid(p))); print()
