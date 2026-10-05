#!/usr/bin/env python3
"""G0 check: every contract file parses, every fixture agrees with its schema (valid ones pass, invalid ones fail),
event fixtures validate against envelope + events schemas, crypto vectors are internally consistent, openapi parses."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from jsonschema_lite import Validator
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
C = os.path.join(ROOT, 'contracts')
V = Validator(os.path.join(C, 'schemas'))
fails, checked = [], 0

def check(cond, msg):
    global checked
    checked += 1
    if not cond: fails.append(msg)

# 1. every json parses; schemas have $id
for dp, _, fns in os.walk(C):
    for fn in fns:
        if fn.endswith('.json'):
            p = os.path.join(dp, fn)
            try: json.load(open(p))
            except Exception as e: check(False, f'{os.path.relpath(p, C)}: invalid JSON ({e})')
for fn in os.listdir(os.path.join(C, 'schemas')):
    s = json.load(open(os.path.join(C, 'schemas', fn)))
    check('$id' in s and '$schema' in s, f'schemas/{fn}: missing $id/$schema')

# 2. generic fixtures {schema, valid, data}
for area in sorted(os.listdir(os.path.join(C, 'fixtures'))):
    d = os.path.join(C, 'fixtures', area)
    if area in ('events', 'crypto'): continue
    for fn in sorted(os.listdir(d)):
        fx = json.load(open(os.path.join(d, fn)))
        errs = V.validate(fx['data'], V.load(fx['schema']))
        check((not errs) == fx['valid'], f'fixtures/{area}/{fn}: expected valid={fx["valid"]}, errors={errs[:3]}')

# 3. event fixtures
ev = V.load('events.schema.json'); env = V.load('envelope.schema.json')
kinds_in_fixtures = set()
for fn in sorted(os.listdir(os.path.join(C, 'fixtures', 'events'))):
    fx = json.load(open(os.path.join(C, 'fixtures', 'events', fn)))
    k = fx['kind']; kinds_in_fixtures.add(k)
    e1 = V.validate(fx['frame'], env); e2 = V.validate(fx['frame'], ev)
    check(not e1 and not e2, f'fixtures/events/{fn}: {(e1 + e2)[:3]}')
    sd = ev['$defs'].get('s_' + k.replace('.', '_'))
    if fx['secret_payload'] is not None:
        check(sd is not None, f'fixtures/events/{fn}: no secret schema')
        if sd: check(not V.validate(fx['secret_payload'], sd, ev), f'fixtures/events/{fn}: secret payload invalid')
    # negative: a cleartext-only kind must reject ct; an encrypted kind must reject p
    fr = json.loads(json.dumps(fx['frame']))
    if 'p' in fr and 'ct' not in fr:
        fr['ct'] = {'alg': 'xchacha20poly1305', 'kid': 'k1', 'n': 'A' * 32, 'c': 'AAAA'}; fr['sig'] = 'AAAA'
        check(V.validate(fr, ev), f'fixtures/events/{fn}: clear kind accepted a ct')
for r in ev['allOf']:
    k = r['if']['properties']['k']['const']
    check(k in kinds_in_fixtures, f'event kind {k}: no fixture')

# 4. state names used by agent.state exist in state-map.json
sm = json.load(open(os.path.join(C, 'state-map.json')))
st = ev['$defs']['p_agent_state']['properties']['state']['enum']
check(sorted(st) == sorted(sm), 'agent.state enum != state-map.json keys')

# 5. crypto vectors self-consistency (re-derive with the generator)
sys.path.insert(0, os.path.dirname(__file__))
import gen_crypto_vectors as g, base64, hashlib
vec = json.load(open(os.path.join(C, 'fixtures', 'crypto', 'vectors.json')))
dec = lambda s: base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))
x = vec['xchacha20poly1305']
try:
    pt = g.xchacha_decrypt(dec(x['key']), dec(x['nonce']), x['aad_jcs'].encode(), dec(x['ciphertext']))
    check(pt.decode() == x['plaintext_jcs'], 'crypto vector: plaintext mismatch')
except Exception as e:
    check(False, f'crypto vector: decrypt failed ({e})')
Kp = dec(vec['keys']['path_mac_key'])
for pm in vec['path_hmac']:
    check(g.b64(hashlib.blake2b(pm['path'].encode(), key=Kp, digest_size=32).digest()) == pm['hmac'], f'crypto vector: path_hmac {pm["path"]}')

# 6. openapi (if present) parses and every operationId is unique
op = os.path.join(C, 'openapi.yaml')
if os.path.exists(op):
    import yaml
    d = yaml.safe_load(open(op)); ids = []
    for path, item in d.get('paths', {}).items():
        for m, o in item.items():
            if m in ('get', 'post', 'put', 'patch', 'delete'): ids.append(o.get('operationId'))
    check(len(ids) == len(set(ids)) and None not in ids, 'openapi: operationIds missing or duplicated')
    check(len(ids) >= 90, f'openapi: only {len(ids)} operations')
else:
    fails.append('openapi.yaml missing')

print(f'{checked} checks, {len(fails)} failures')
for f in fails: print(' FAIL', f)
sys.exit(1 if fails else 0)
