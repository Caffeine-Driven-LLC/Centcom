#!/usr/bin/env python3
"""Progress bar + next steps for a repo's README.

  python3 tools/plan/progress.py            # rewrite docs/progress.svg and the README block
  python3 tools/plan/progress.py --check    # exit 1 if either is out of date (for CI)

Inputs
  plan/<side>/*.md   lane cards (size, milestone, dependencies) - read only
  plan/STATUS.json   what is built: {"lanes": {"C033": {"pct": 1, "note": "..."}}, "next": [{"title": "...", "why": "..."}]}
                     Lanes not listed are 0%. pct is 0..1. Update this file when you finish or advance a lane.
Weights follow plan/SIZING.md: S=1, M=3, L=5 person-days (this reproduces the milestone totals in plan/ROADMAP.md).
The side (client|backend) defaults to the one this repo builds: backend if the folder name contains "backend".
"""
import glob, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
W = {'S': 1, 'M': 3, 'L': 5, 'XL': 8}
ORDER = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'Later']
NAMES = {'M0': 'Contracts and scaffolding', 'M1': 'Solo agent in the terminal', 'M2': 'LAN multiplayer', 'M3': 'Accounts and relay', 'M4': 'Teams and money', 'M5': 'Fleet and polish', 'M6': 'Launch', 'Later': 'After launch'}
START, END = '<!-- progress:start -->', '<!-- progress:end -->'


def side():
    for i, a in enumerate(sys.argv):
        if a == '--side' and i + 1 < len(sys.argv): return sys.argv[i + 1]
    return 'backend' if 'backend' in os.path.basename(ROOT).lower() else 'client'


def lanes(s):
    out = {}
    for f in sorted(glob.glob(os.path.join(ROOT, 'plan', s, ('B' if s == 'backend' else 'C') + '[0-9]*.md'))):
        t = open(f, encoding='utf8').read()
        h = re.search(r'^# (\w+) · (.+)$', t, re.M)
        if not h: continue
        g = lambda k: (re.search(r'\*\*' + k + r'\*\* \| (.+?) \|', t) or [None, ''])[1]
        deps = re.findall(r'\b([BC]\d{3})\b', g('Depends on'))
        out[h.group(1)] = dict(id=h.group(1), title=h.group(2).strip(), ms=g('Milestone').strip() or '?', size=(g('Size').split() or ['M'])[0], deps=deps)
    return out


def load_status():
    p = os.path.join(ROOT, 'plan', 'STATUS.json')
    return json.load(open(p)) if os.path.exists(p) else {'lanes': {}, 'next': []}


def stats(L, st):
    pct = lambda i: max(0.0, min(1.0, float(st['lanes'].get(i, {}).get('pct', 0))))
    tot = {m: [0.0, 0.0, 0, 0] for m in ORDER}  # done weight, total weight, lanes done, lanes
    for i, l in L.items():
        m = l['ms'] if l['ms'] in tot else 'Later'; w = W.get(l['size'], 3)
        tot[m][0] += w * pct(i); tot[m][1] += w; tot[m][3] += 1; tot[m][2] += 1 if pct(i) >= 0.95 else 0
    d = sum(v[0] for v in tot.values()); t = sum(v[1] for v in tot.values())
    return tot, (d / t if t else 0.0), pct


def svg(title, overall, tot, plan_pct=1.0):
    fmt = lambda x: f'{round(x * 100)}%'
    rows = [m for m in ORDER if tot[m][1]]
    H = 118 + 20 * len(rows)
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="760" height="{H}" viewBox="0 0 760 {H}" role="img" aria-label="{title}: {fmt(overall)} built">',
         '<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#3DF2C8"/></linearGradient>',
         '<pattern id="s" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="12" height="24" fill="#fff" fill-opacity=".16"/></pattern>',
         '<clipPath id="c"><rect x="24" y="52" width="712" height="26" rx="13"/></clipPath>',
         '<linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>',
         '<style>@keyframes mv{to{transform:translateX(24px)}}@keyframes sh{from{transform:translateX(-200px)}to{transform:translateX(760px)}}@keyframes gl{50%{opacity:.78}}',
         '.st{animation:mv .9s linear infinite}.sh{animation:sh 3.2s ease-in-out infinite}.gl{animation:gl 2.4s ease-in-out infinite}text{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}',
         '@media (prefers-reduced-motion:reduce){.st,.sh,.gl{animation:none}}</style>',
         f'<rect width="760" height="{H}" rx="16" fill="#0B1026"/><rect x=".5" y=".5" width="759" height="{H-1}" rx="15.5" fill="none" stroke="#2A3568"/>',
         f'<text x="24" y="34" fill="#E6EBFF" font-size="16" font-weight="700">{title}</text>',
         f'<text x="736" y="34" fill="#3DF2C8" font-size="16" font-weight="700" text-anchor="end">{fmt(overall)} built</text>',
         '<rect x="24" y="52" width="712" height="26" rx="13" fill="#141C3E"/>']
    fw = max(0.0, 712 * overall)
    if fw > 0:
        o.append(f'<g clip-path="url(#c)"><g class="gl"><rect x="24" y="52" width="{fw:.1f}" height="26" fill="url(#g)"/><rect x="24" y="52" width="{fw:.1f}" height="26" fill="url(#s)" class="st"/>'
                 f'<rect x="24" y="52" width="160" height="26" fill="url(#sh)" class="sh" style="mix-blend-mode:screen"/></g></g>')
        o.append(f'<rect x="{24 + fw - 2:.1f}" y="52" width="4" height="26" rx="2" fill="#fff" fill-opacity=".85" class="gl"/>')
    o.append(f'<text x="24" y="100" fill="#A9B6E8" font-size="12">Plan and contracts {fmt(plan_pct)} · implementation by lane size · updated from plan/STATUS.json</text>')
    y = 114
    for m in rows:
        d, t, ld, ln = tot[m]; p = d / t if t else 0
        o.append(f'<text x="24" y="{y + 11}" fill="#A9B6E8" font-size="11">{m}</text><text x="64" y="{y + 11}" fill="#7384CC" font-size="11">{NAMES[m]}</text>')
        o.append(f'<rect x="270" y="{y + 3}" width="350" height="8" rx="4" fill="#141C3E"/>')
        if p > 0: o.append(f'<rect x="270" y="{y + 3}" width="{350 * p:.1f}" height="8" rx="4" fill="url(#g)"/>')
        o.append(f'<text x="736" y="{y + 11}" fill="#C9D2F5" font-size="11" text-anchor="end">{fmt(p)} · {ld}/{ln} lanes</text>')
        y += 20
    o.append('</svg>')
    return '\n'.join(o) + '\n'


def block(s, L, st, tot, overall):
    ready = []
    for i, l in L.items():
        if st['lanes'].get(i, {}).get('pct', 0) >= 0.95: continue
        if all(st['lanes'].get(d, {}).get('pct', 0) >= 0.95 for d in l['deps']):
            ready.append(l)
    mi = {m: n for n, m in enumerate(ORDER)}
    ready.sort(key=lambda l: (mi.get(l['ms'], 9), -W.get(l['size'], 3) * 0 + len(l['deps']), l['id']))
    # in-progress lanes first: they are the cheapest to finish
    partial = [L[i] for i, v in st['lanes'].items() if i in L and 0 < v.get('pct', 0) < 0.95]
    lines = [START, '', '## Progress', '', f'![Progress](docs/progress.svg)', '',
             f'**{round(overall * 100)}% built** (weighted by lane size across {len(L)} lanes). Details and how this is computed: [`tools/plan/progress.py`](tools/plan/progress.py). Update [`plan/STATUS.json`](plan/STATUS.json) when you finish or advance a lane, then run `python3 tools/plan/progress.py`.', '']
    if st.get('next'):
        lines += ['## Next steps', '']
        for n, x in enumerate(st['next'], 1): lines.append(f"{n}. **{x['title']}**" + (f" — {x['why']}" if x.get('why') else ''))
        lines.append('')
    if partial:
        lines += ['### Started, not finished', '', '| Lane | What | Done | Note |', '|---|---|--:|---|']
        for l in sorted(partial, key=lambda l: -st['lanes'][l['id']]['pct'])[:8]:
            lines.append(f"| [{l['id']}](plan/{s}/{l['id']}.md) | {l['title']} | {round(st['lanes'][l['id']]['pct'] * 100)}% | {st['lanes'][l['id']].get('note', '')} |")
        if len(partial) > 8: lines.append(f'\n+{len(partial) - 8} more in [`plan/STATUS.json`](plan/STATUS.json).')
        lines.append('')
    lines += ['### Ready to pick up (all dependencies done)', '', '| Lane | What | Size | Milestone |', '|---|---|---|---|']
    for l in [r for r in ready if r['id'] not in {p['id'] for p in partial}][:10]:
        lines.append(f"| [{l['id']}](plan/{s}/{l['id']}.md) | {l['title']} | {l['size']} | {l['ms']} |")
    lines += ['', 'Each lane card lists its goal, contracts, acceptance criteria and tests. Read [`plan/START_HERE.md`](plan/START_HERE.md) first.', '', END]
    return '\n'.join(lines)


def main():
    s = side(); L = lanes(s); st = load_status()
    if not L: sys.exit(f'no lane cards found for side "{s}" under plan/{s}')
    tot, overall, _ = stats(L, st)
    title = 'Centcom client' if s == 'client' else 'Centcom backend'
    svg_text = svg(title, overall, tot)
    readme = os.path.join(ROOT, 'README.md'); cur = open(readme, encoding='utf8').read()
    b = block(s, L, st, tot, overall)
    new = re.sub(re.escape(START) + r'.*?' + re.escape(END), lambda _: b, cur, flags=re.S) if START in cur else None
    if new is None:  # first run: put it right after the first paragraph/status line, before the first "## "
        i = cur.find('\n## '); new = (cur[:i] + '\n\n' + b + '\n' + cur[i:]) if i >= 0 else cur + '\n\n' + b + '\n'
    svg_path = os.path.join(ROOT, 'docs', 'progress.svg'); old_svg = open(svg_path).read() if os.path.exists(svg_path) else ''
    if '--check' in sys.argv:
        if old_svg != svg_text or new != cur: sys.exit('progress is out of date: run python3 tools/plan/progress.py')
        print('progress up to date'); return
    os.makedirs(os.path.dirname(svg_path), exist_ok=True); open(svg_path, 'w').write(svg_text); open(readme, 'w', encoding='utf8').write(new)
    print(f'{s}: {round(overall * 100)}% built · ' + ' · '.join(f"{m} {round(tot[m][0] / tot[m][1] * 100) if tot[m][1] else 0}%" for m in ORDER if tot[m][1]))


main()
