"""One-off seed for plan/milestones.json (edit the json afterwards, not this file)."""
import json, sys
sys.path.insert(0, 'tools/plan')
from planlib import *
sk = load_skeleton()
def R(p, a, b): return ['%s%03d' % (p, i) for i in range(a, b + 1)]
M = {}
def put(m, ids):
    for i in ids: M[i] = m
# ---- client
put('M0', R('C', 1, 12))
put('M1', R('C', 13, 17) + R('C', 19, 23) + R('C', 25, 30) + R('C', 31, 48) + ['C050'] + ['C101', 'C102', 'C103', 'C104'])
put('M2', ['C051', 'C054', 'C055', 'C056', 'C058', 'C059', 'C060', 'C061', 'C067', 'C071', 'C072', 'C073', 'C074', 'C075', 'C076', 'C105'])
put('M3', ['C052', 'C053', 'C057', 'C063'])
put('M4', ['C064', 'C065', 'C066', 'C081', 'C082', 'C083', 'C085', 'C086', 'C087', 'C088', 'C089'])
put('M5', ['C018', 'C024', 'C062', 'C068', 'C069', 'C070', 'C077', 'C078', 'C079', 'C080', 'C084', 'C090', 'C092', 'C093'])
put('M6', ['C049', 'C094', 'C095', 'C096', 'C097', 'C098', 'C099', 'C100'])
put('Later', ['C091'])
# ---- backend
put('M0', R('B', 1, 12))
put('M3', R('B', 13, 29) + ['B031', 'B033', 'B036'] + R('B', 37, 56) + ['B083', 'B086', 'B091', 'B092', 'B101'])
put('M4', ['B030', 'B032', 'B034', 'B035', 'B063', 'B064', 'B065', 'B066', 'B068'] + R('B', 69, 80) + ['B093'])
put('M5', R('B', 57, 62) + ['B067', 'B081', 'B082', 'B084', 'B085', 'B087', 'B090', 'B094'])
put('M6', ['B095', 'B096', 'B097', 'B098', 'B099', 'B100'])
put('Later', ['B088', 'B089'])
allids = [l['id'] for p in PLANS for l in sk[p]]
missing = [i for i in allids if i not in M]; extra = [i for i in M if i not in allids]
print('missing', missing, 'extra', extra)
order = {'M0': 0, 'M1': 1, 'M2': 2, 'M3': 3, 'M4': 4, 'M5': 5, 'M6': 6, 'Later': 7}
bad = []
for p in PLANS:
    for l in sk[p]:
        for d in l['depends_on']:
            if order[M[d]] > order[M[l['id']]]: bad.append((l['id'], M[l['id']], d, M[d]))
print(len(bad), 'ordering conflicts'); [print(b) for b in bad]
json.dump(M, open('/tmp/claude-1000/-home-devlsx-Desktop-actualprojects-Centcom/52981fc1-f5cc-49b2-92c5-5ac10b978723/scratchpad/ms.json', 'w'), indent=1)
