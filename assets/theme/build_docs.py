#!/usr/bin/env python3
"""Renders ../DESIGN.md from DESIGN.template.md, filling the generated tables from the real data files."""
import json, os, re
from build_theme import RAMPS, SEMANTIC, STATUS, STATE_MAP, main as build_theme

HERE = os.path.dirname(os.path.abspath(__file__))
md_contrast = build_theme()   # (re)generates tokens and returns the contrast table
anims = json.load(open(f'{HERE}/../mascot/animations.json'))['animations']
lines = [l for l in open(f'{HERE}/../The-Lines.txt') if l.strip()]

def table(head, rows):
    return '\n'.join(['| ' + ' | '.join(head) + ' |', '|' + '---|' * len(head)] + ['| ' + ' | '.join(str(c) for c in r) + ' |' for r in rows])

# animation categories
cats = {}
for a in anims:
    cats.setdefault(a['cat'], []).append(a['name'])
anim_table = table(['Category', 'Count', 'Examples'], [(c, len(n), ', '.join('`%s`' % x for x in n[:5])) for c, n in cats.items()])

# palette
pal_rows = [(r, k, '`%s`' % v) for r, d in RAMPS.items() for k, v in d.items()]
palette = '\n\n'.join('**%s**\n\n%s' % (r, table(['Step', 'Hex'], [(k, '`%s`' % v) for k, v in d.items()])) for r, d in RAMPS.items())

semantic = table(['Token', 'Abyss (dark)', 'Shallows (light)'], [(f'`{k}`', f'`{d}`', f'`{l}`') for k, (d, l) in SEMANTIC.items()])

anim_cat = {a['name']: a['cat'] for a in anims}
statemap = table(['UI state', 'Mascot animation', 'Category'], [(f'`{s}`', f'`{a}`', anim_cat[a]) for s, a in STATE_MAP.items()])

# colour fallbacks: nearest xterm-256 index and nearest ANSI-16 slot
def xterm256():
    lv = [0, 95, 135, 175, 215, 255]
    pal = {16 + 36 * r + 6 * g + b: (lv[r], lv[g], lv[b]) for r in range(6) for g in range(6) for b in range(6)}
    pal.update({232 + i: (8 + 10 * i,) * 3 for i in range(24)})
    return pal
X = xterm256()
ANSI16 = {'black': (11, 16, 38), 'red': (255, 92, 92), 'green': (74, 222, 128), 'yellow': (255, 209, 102), 'blue': (90, 169, 255),
          'magenta': (168, 146, 255), 'cyan': (61, 242, 200), 'white': (169, 182, 232),
          'bright black': (61, 74, 133), 'bright white': (230, 235, 255)}
def rgb(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def near(c, pal): return min(pal.items(), key=lambda kv: sum((a - b) ** 2 for a, b in zip(kv[1], c)))[0]
key = [('bg.base', '#07091A'), ('bg.surface', '#0B1026'), ('border.default', '#2A3568'), ('text.primary', '#E6EBFF'), ('text.secondary', '#A9B6E8'),
       ('text.muted', '#7384CC'), ('accent.primary / mascot violet', '#7C5CFF'), ('accent.fill', '#6B49F0'), ('signal', '#3DF2C8'),
       ('status.success', '#4ADE80'), ('status.warning', '#FFD166'), ('status.danger', '#FF5C5C'), ('status.info', '#5AA9FF')]
fallbacks = table(['Token', 'Truecolor', 'xterm-256', 'ANSI-16 slot'], [(n, '`%s`' % h, near(rgb(h), X), near(rgb(h), ANSI16)) for n, h in key])

t = open(f'{HERE}/DESIGN.template.md').read()
rep = {'{{ANIM_TOTAL}}': str(len(anims)), '{{ANIM_CATS}}': str(len(cats)), '{{ANIM_TABLE}}': anim_table, '{{PALETTE}}': palette,
       '{{SEMANTIC}}': semantic, '{{CONTRAST}}': md_contrast, '{{STATEMAP}}': statemap, '{{LINES_COUNT}}': str(len(lines)),
       '{{FALLBACKS}}': fallbacks, '{{FALLBACK_NOTE}}': 'nearest entry of the 6×6×6 cube or the 24-step grey ramp'}
for k, v in rep.items():
    t = t.replace(k, v)
left = re.findall(r'\{\{[A-Z_]+\}\}', t)
assert not left, left
open(f'{HERE}/../DESIGN.md', 'w').write(t)
print('DESIGN.md:', len(t.splitlines()), 'lines,', len(t.split()), 'words')
