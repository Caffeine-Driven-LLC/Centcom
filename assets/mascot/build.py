#!/usr/bin/env python3
"""Renders every Cento animation.

  python3 build.py            animations.json + svg/ + gif/<variant>/<name>.gif
  python3 build.py --sheets   also write contact sheets (SHEETS=<dir>) for eyeballing

GIF variants: 5 solo colours (violet, red, yellow, green, brown) and mixed-colour crowds
(duo, trio, squad, group). Every GIF loops its animation until it is at least MIN_MS long."""
import json, os, sys, math, bisect, shutil
from PIL import Image, ImageDraw
import cento_lib as L
from animations import ANIMS
import animations_ui       # noqa: F401  (registers ui_* animations)
import animations_stories  # noqa: F401  (registers stories)

BG = (19, 17, 31)
PAD = 1
MIN_MS = 4000
COLORS = L.COLORS
# (colours per copy, columns) for the mixed crowds
CROWDS = {
    'duo':   (['violet', 'green'], 2),
    'trio':  (['violet', 'red', 'yellow'], 3),
    'squad': (['violet', 'red', 'yellow', 'green'], 2),
    'group': (['violet', 'yellow', 'red', 'brown', 'green', 'violet'], 3),
}
# scenes that already contain two characters: one scene = one (me, friend) pair
PAIR_CROWDS = {
    'duo':   ([('violet', 'green')], 1),
    'squad': ([('violet', 'green'), ('red', 'yellow')], 2),
    'group': ([('violet', 'green'), ('red', 'yellow'), ('brown', 'violet')], 3),
}


def hex2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def prep(frames):
    out = []
    for i, fr in enumerate(frames):
        me = dict(fr['me'])
        if me.pop('_autolg', False):
            me['lg'] = 'a' if i % 2 == 0 else 'b'
        friend = None
        if fr['fr'] is not None:
            friend = dict(fr['fr'])
            friend.setdefault('lg', me.get('lg', 'a'))
        out.append(dict(fr, me=me, fr=friend))
    return out


class Anim:
    def __init__(self, a):
        self.name, self.cat, self.desc, self.gap = a['name'], a['cat'], a['desc'], a['gap']
        self.frames = prep(a['frames'])
        self.durs = [fr['d'] for fr in self.frames]
        self.social = any(fr['fr'] is not None for fr in self.frames)
        self._cache = {}
        grids = self.grids('violet', 'red')
        self.box = L.bbox(grids)
        x0, y0, x1, y1 = self.box
        self.x0, self.y0 = max(0, x0 - PAD), max(0, y0 - PAD)
        self.x1, self.y1 = min(L.CW - 1, x1 + PAD), min(L.CH - 1, y1 + PAD)
        self.w, self.h = self.x1 - self.x0 + 1, self.y1 - self.y0 + 1

    def grids(self, me, friend):
        key = (me, friend)
        if key not in self._cache:
            self._cache[key] = [L.render_frame(fr, self.gap, friend, me) for fr in self.frames]
        return self._cache[key]

    def cropped(self, me, friend):
        return [[''.join(r[self.x0:self.x1 + 1]) for r in g[self.y0:self.y1 + 1]] for g in self.grids(me, friend)]

    def total(self):
        return sum(self.durs)


def build_all():
    anims, seen = [], set()
    for a in ANIMS:
        assert a['name'] not in seen, 'duplicate ' + a['name']
        seen.add(a['name'])
        anims.append(Anim(a))
    return anims


# ---------------------------------------------------------------- compositing
def compose(cells, durs, cols, gap=2):
    """cells: list of cropped frame lists (one per character/scene). Staggers them in time and
    tiles them on a grid. Returns [(rows, duration_ms)] covering one loop."""
    n, T = len(cells), sum(durs)
    starts = [sum(durs[:i]) for i in range(len(durs))]
    shifts = [(j * T) // (2 * n) if n > 1 else 0 for j in range(n)]
    h, w = len(cells[0][0]), len(cells[0][0][0])
    bps = {0, T}
    for sh in shifts:
        for s in starts:
            bps.add((s - sh) % T)
    bps = sorted(bps)
    rows_n = math.ceil(n / cols)
    out = []
    for a, b in zip(bps, bps[1:]):
        canvas = [['.'] * (cols * (w + gap) - gap) for _ in range(rows_n * (h + gap) - gap)]
        for j in range(n):
            idx = bisect.bisect_right(starts, (a + shifts[j]) % T) - 1
            ox, oy = (j % cols) * (w + gap), (j // cols) * (h + gap)
            for y, row in enumerate(cells[j][idx]):
                for x, ch in enumerate(row):
                    if ch != '.':
                        canvas[oy + y][ox + x] = ch
        out.append([''.join(r) for r in canvas])
        out[-1] = (out[-1], b - a)
    return out


def loop_to(frames, min_ms=MIN_MS):
    """frames: [(rows, ms)]. Repeat the sequence until it lasts at least min_ms."""
    T = sum(d for _, d in frames)
    return frames * max(1, math.ceil(min_ms / T))


# ---------------------------------------------------------------- drawing
_IMG = {}


def draw_frame(rows, scale, bg=BG):
    key = (tuple(rows), scale)
    if key in _IMG:
        return _IMG[key]
    h, w = len(rows), len(rows[0])
    im = Image.new('RGB', (w * scale, h * scale), bg)
    d = ImageDraw.Draw(im)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != '.':
                d.rectangle([x * scale, y * scale, (x + 1) * scale - 1, (y + 1) * scale - 1], fill=hex2rgb(L.PAL_HEX[ch]))
    _IMG[key] = im
    return im


def save_gif(path, frames, scale):
    ims = [draw_frame(r, scale) for r, _ in frames]
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=[d for _, d in frames], loop=0, disposal=2, optimize=True)


def svg_for(name, rows_durs, w, h, scale=8):
    w, h = w * scale, h * scale
    total = sum(d for _, d in rows_durs)
    css, groups, t = [], [], 0
    for i, (rows, d) in enumerate(rows_durs):
        s, e = t / total * 100, (t + d) / total * 100
        t += d
        if i == 0:
            kf = f'0%{{visibility:visible}}{e:.3f}%{{visibility:hidden}}100%{{visibility:hidden}}'
        elif i == len(rows_durs) - 1:
            kf = f'0%{{visibility:hidden}}{s:.3f}%{{visibility:visible}}100%{{visibility:visible}}'
        else:
            kf = f'0%{{visibility:hidden}}{s:.3f}%{{visibility:visible}}{e:.3f}%{{visibility:hidden}}100%{{visibility:hidden}}'
        css.append(f'@keyframes f{i}{{{kf}}}.f{i}{{animation:f{i} {total}ms steps(1,end) infinite}}')
        rects = []
        for y, row in enumerate(rows):
            x = 0
            while x < len(row):
                ch = row[x]
                if ch == '.': x += 1; continue
                k = x
                while k < len(row) and row[k] == ch: k += 1
                rects.append(f'<rect x="{x*scale}" y="{y*scale}" width="{(k-x)*scale}" height="{scale}" fill="{L.PAL_HEX[ch]}"/>')
                x = k
        groups.append(f'<g class="f{i}">{"".join(rects)}</g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" shape-rendering="crispEdges">'
            f'<style>{"".join(css)}</style>{"".join(groups)}</svg>\n')


def write_all(anims, out='.'):
    for d in ('svg', 'gif'):
        shutil.rmtree(f'{out}/{d}', ignore_errors=True)
        os.makedirs(f'{out}/{d}')
    for v in COLORS + list(CROWDS):
        os.makedirs(f'{out}/gif/{v}', exist_ok=True)
    meta = dict(palette=L.PAL_HEX, colors=COLORS, palmap=L.PALMAP, friend_chars='123', animations=[])
    for n, a in enumerate(anims):
        canon = a.cropped('violet', 'green')
        meta['animations'].append(dict(name=a.name, cat=a.cat, desc=a.desc, w=a.w, h=a.h, social=a.social,
                                       frames=[dict(d=d, rows=r) for d, r in zip(a.durs, canon)]))
        open(f'{out}/svg/{a.name}.svg', 'w').write(svg_for(a.name, list(zip(canon, a.durs)), a.w, a.h))
        # solo colours (social scenes: friend takes the next colour in the list)
        for k, c in enumerate(COLORS):
            fr = list(zip(a.cropped(c, COLORS[(k + 1) % len(COLORS)]), a.durs))
            save_gif(f'{out}/gif/{c}/{a.name}.gif', loop_to(fr), 5)
        # mixed crowds
        if a.social:
            for v, (pairs, cols) in PAIR_CROWDS.items():
                cells = [a.cropped(m, f) for m, f in pairs]
                save_gif(f'{out}/gif/{v}/{a.name}.gif', loop_to(compose(cells, a.durs, cols)), 4)
        else:
            for v, (cols_, ncols) in CROWDS.items():
                cells = [a.cropped(c, 'green') for c in cols_]
                save_gif(f'{out}/gif/{v}/{a.name}.gif', loop_to(compose(cells, a.durs, ncols)), 4)
        _IMG.clear()
        if n % 25 == 0:
            print(f'  {n}/{len(anims)}', flush=True)
    json.dump(meta, open(f'{out}/animations.json', 'w'), separators=(',', ':'))


def contact_sheets(anims, out, per=30, cols=6, cell=(230, 190)):
    paths = []
    os.makedirs(out, exist_ok=True)
    for n in range(0, len(anims), per):
        chunk = anims[n:n + per]
        rows = math.ceil(len(chunk) / cols)
        sheet = Image.new('RGB', (cols * cell[0], rows * cell[1]), BG)
        d = ImageDraw.Draw(sheet)
        for i, a in enumerate(chunk):
            k = len(a.frames) // 2
            im = draw_frame(a.cropped('violet', 'green')[k], max(2, min((cell[0] - 10) // a.w, (cell[1] - 28) // a.h)))
            cx, cy = (i % cols) * cell[0], (i // cols) * cell[1]
            sheet.paste(im, (cx + (cell[0] - im.width) // 2, cy + 4))
            d.text((cx + 6, cy + cell[1] - 20), a.name, fill=(217, 210, 255))
        p = f'{out}/sheet_{n // per + 1}.png'
        sheet.save(p); paths.append(p)
    return paths


if __name__ == '__main__':
    anims = build_all()
    print(len(anims), 'animations,', sum(len(a.frames) for a in anims), 'base frames')
    if '--sheets' in sys.argv:
        print(contact_sheets(anims, os.environ['SHEETS']))
    else:
        write_all(anims, '.')
        from collections import Counter
        print(Counter(a.cat for a in anims))
