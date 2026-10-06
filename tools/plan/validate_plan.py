#!/usr/bin/env python3
"""Validates the lane plan.
  validate_plan.py                      everything (skeleton, cards, contract coverage, gates)
  validate_plan.py --plan backend --ids B001-B025   only those cards' rules (used by card authors)
Exit code 1 on any error."""
import argparse, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from planlib import *

GATES = {'G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'}
REQ = ['id', 'title', 'plan', 'phase', 'size', 'role', 'depends_on', 'goal', 'scope_in', 'scope_out', 'implements', 'consumes', 'build_against',
       'deliverables', 'interfaces', 'acceptance', 'tests', 'guardrails', 'failure_modes', 'unblocks_gate']
MINS = {'scope_in': 3, 'scope_out': 2, 'deliverables': 2, 'interfaces': 1, 'acceptance': 5, 'tests': 3, 'guardrails': 3, 'failure_modes': 2}
TEXT_FIELDS = ['goal', 'scope_in', 'scope_out', 'build_against', 'interfaces', 'acceptance', 'tests', 'guardrails', 'failure_modes', 'notes']

def flat(c):
    out = []
    for f in TEXT_FIELDS:
        v = c.get(f)
        if isinstance(v, str): out.append(v)
        elif isinstance(v, list): out += [x for x in v if isinstance(x, str)]
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--plan'); ap.add_argument('--ids'); ap.add_argument('--quiet', action='store_true')
    a = ap.parse_args()
    skel, index = load_skeleton(), load_index()
    contract_ids = {c['id'] for c in index['contracts']}
    errors, warns = [], []
    E = lambda m: errors.append(m)
    full = a.ids is None

    for plan in PLANS:
        if a.plan and a.plan != plan: continue
        lanes = skel[plan]; ids = [l['id'] for l in lanes]; pre = PREFIX[plan]; other = 'C' if pre == 'B' else 'B'
        if full:
            if len(lanes) < 100: E(f'{plan}: {len(lanes)} lanes in skeleton (need at least 100)')
        if len(set(ids)) != len(ids): E(f'{plan}: duplicate lane ids')
        deps = {l['id']: l['depends_on'] for l in lanes}
        for i, d in deps.items():
            for x in d:
                if x not in deps: E(f'{plan} {i}: depends_on {x} is not a lane in this plan')
        try: topo_layers(deps)
        except ValueError as e: E(f'{plan}: {e}')
        cards = load_cards(plan)
        want = parse_ids(a.ids, plan) if a.ids else ids
        sk = {l['id']: l for l in lanes}
        claimed = {}
        for i in want:
            c = cards.get(i)
            if c is None: E(f'{i}: card missing'); continue
            for f in REQ:
                if f not in c: E(f'{i}: missing field {f}')
            for f in ('id', 'title', 'plan', 'phase', 'size', 'role', 'depends_on'):
                if f in c and c[f] != sk[i][f]: E(f'{i}: {f} differs from skeleton ({c[f]!r} != {sk[i][f]!r})')
            for f, n in MINS.items():
                v = c.get(f)
                if not isinstance(v, list) or len(v) < n: E(f'{i}: {f} needs >= {n} items')
                elif any((not isinstance(x, str)) or len(x.strip()) < 8 for x in v): E(f'{i}: {f} has empty/too-short items')
            for f in ('goal', 'build_against'):
                if not isinstance(c.get(f), str) or len(c.get(f, '')) < 20: E(f'{i}: {f} too short')
            for k in ('implements', 'consumes'):
                for cid in c.get(k, []):
                    if cid not in contract_ids: E(f'{i}: unknown contract {cid} in {k}')
            ic = {x['id']: x for x in index['contracts']}
            for cid in c.get('implements', []):
                if cid in ic and plan not in ic[cid]['implemented_by']: E(f'{i}: implements {cid} but the contract index says {plan} does not implement it (use consumes)')
            if set(c.get('implements', [])) & set(c.get('consumes', [])): E(f'{i}: same contract in implements and consumes')
            g = c.get('unblocks_gate')
            if g is not None and g not in GATES: E(f'{i}: bad unblocks_gate {g!r}')
            text = ' '.join(flat(c))
            for m in set(re.findall(r'\b%s\d{3}\b' % other, text)): E(f'{i}: references other-plan lane {m} (use contract ids / mock names only)')
            for m in set(re.findall(r'\b%s\d{3}\b' % pre, text)):
                if m not in sk: E(f'{i}: references unknown lane {m}')
            for dpath in c.get('deliverables', []):
                if dpath.startswith('contracts/') or dpath.startswith('/') or '..' in dpath: E(f'{i}: illegal deliverable path {dpath}')
                if dpath in claimed and claimed[dpath] != i: E(f'{i}: deliverable {dpath} also claimed by {claimed[dpath]}')
                claimed.setdefault(dpath, i)
        # collisions against already-existing cards outside the checked range (when partial)
        if not full:
            for j, cj in cards.items():
                if j in want: continue
                for dpath in cj.get('deliverables', []):
                    if dpath in claimed: E(f'{claimed[dpath]}: deliverable {dpath} also claimed by {j}')

    if full and not a.plan:
        cards = {p: load_cards(p) for p in PLANS}
        impl = {p: {} for p in PLANS}; cons = {p: {} for p in PLANS}
        for p in PLANS:
            for i, c in cards[p].items():
                for cid in c.get('implements', []): impl[p].setdefault(cid, []).append(i)
                for cid in c.get('consumes', []): cons[p].setdefault(cid, []).append(i)
        for c in index['contracts']:
            for p in c['implemented_by']:
                if not impl[p].get(c['id']): E(f'contract {c["id"]}: no {p} lane implements it')
            for p in c['consumed_by']:
                if not (cons[p].get(c['id']) or impl[p].get(c['id'])): E(f'contract {c["id"]}: no {p} lane consumes it')
            if c['kind'] == 'wire':
                for p in set(c['implemented_by']) | set(c['consumed_by']):
                    if not any(cid == c['id'] for cid in cons[p]) and not impl[p].get(c['id']): E(f'contract {c["id"]}: wire contract untouched by {p}')
        # conformance lanes must consume every contract their side implements
        for p, lane in (('backend', 'B100'), ('client', 'C100')):
            card = cards[p].get(lane)
            if card:
                need = {c['id'] for c in index['contracts'] if p in c['implemented_by']}
                miss = need - set(card.get('consumes', []))
                if miss: E(f'{lane}: conformance lane must consume {sorted(miss)}')
        for g in sorted(GATES - {'G0'}):
            for p in PLANS:
                if not any(c.get('unblocks_gate') == g for c in cards[p].values()): warns.append(f'gate {g}: no {p} lane declares unblocks_gate={g}')

    if not a.quiet:
        for w in warns: print('WARN ', w)
    for e in errors: print('ERROR', e)
    print(f'{len(errors)} errors, {len(warns)} warnings')
    sys.exit(1 if errors else 0)

if __name__ == '__main__':
    main()
