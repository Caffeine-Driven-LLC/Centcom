"""Shared loading code for the plan tools."""
import json, os, re
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PLAN = os.path.join(ROOT, 'plan')
SIZE_DAYS = {'S': 1, 'M': 3, 'L': 5}
PLANS = ('backend', 'client')
PREFIX = {'backend': 'B', 'client': 'C'}

def load_skeleton():
    return json.load(open(os.path.join(PLAN, 'skeleton.json')))

def load_index():
    return json.load(open(os.path.join(ROOT, 'contracts', 'index.json')))

def load_cards(plan):
    d = os.path.join(PLAN, 'lanes', plan)
    out = {}
    if os.path.isdir(d):
        for fn in sorted(os.listdir(d)):
            if fn.endswith('.json'):
                out[fn[:-5]] = json.load(open(os.path.join(d, fn)))
    return out

def parse_ids(spec, plan):
    """'B001-B025' or 'B001,B003' -> list of ids"""
    if not spec: return None
    ids = []
    for part in spec.split(','):
        if '-' in part:
            a, b = part.split('-'); pre = a[0]
            ids += ['%s%03d' % (pre, i) for i in range(int(a[1:]), int(b[1:]) + 1)]
        else: ids.append(part)
    return ids

def topo_layers(lanes):
    """lanes: dict id -> deps. Returns list of layers, or raises on cycle."""
    remaining = {k: set(v) for k, v in lanes.items()}
    layers = []
    while remaining:
        ready = sorted(k for k, d in remaining.items() if not (d & set(remaining)))
        if not ready: raise ValueError('cycle among: ' + ', '.join(sorted(remaining)[:10]))
        layers.append(ready)
        for k in ready: del remaining[k]
    return layers

def critical_path(skel_lanes):
    by = {l['id']: l for l in skel_lanes}
    memo = {}
    def best(i):
        if i in memo: return memo[i]
        l = by[i]
        deps = [best(d) for d in l['depends_on']]
        top = max(deps, key=lambda x: x[0], default=(0, []))
        memo[i] = (top[0] + SIZE_DAYS[l['size']], top[1] + [i])
        return memo[i]
    return max((best(i) for i in by), key=lambda x: x[0])
