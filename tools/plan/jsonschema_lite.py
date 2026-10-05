"""Minimal JSON Schema (2020-12 subset) validator, enough for the Centcom contracts. Zero dependencies.
Supports: type, enum, const, pattern, min/maxLength, minimum/maximum, items, min/maxItems, properties, required,
additionalProperties, min/maxProperties, $ref (#/$defs/x and sibling files), allOf/anyOf/oneOf/not, if/then/else."""
import json, os, re

class Validator:
    def __init__(self, base_dir):
        self.base = base_dir
        self.cache = {}

    def load(self, name):
        if name not in self.cache:
            self.cache[name] = json.load(open(os.path.join(self.base, name)))
        return self.cache[name]

    def validate(self, instance, schema, root=None, here=None):
        errs = []
        self._v(instance, schema, root if root is not None else schema, here or '', errs, '')
        return errs

    def _resolve(self, ref, root):
        if ref.startswith('#'):
            node = root
            for part in ref[2:].split('/') if len(ref) > 1 else []:
                node = node[part.replace('~1', '/').replace('~0', '~')]
            return node, root
        fname, _, frag = ref.partition('#')
        doc = self.load(fname)
        node = doc
        for part in frag.lstrip('/').split('/') if frag else []:
            node = node[part]
        return node, doc

    def _type_ok(self, v, t):
        return {'string': isinstance(v, str), 'integer': isinstance(v, int) and not isinstance(v, bool),
                'number': isinstance(v, (int, float)) and not isinstance(v, bool), 'boolean': isinstance(v, bool),
                'object': isinstance(v, dict), 'array': isinstance(v, list), 'null': v is None}[t]

    def _v(self, v, s, root, here, errs, path):
        if s is True or s == {}: return
        if s is False: errs.append(f'{path or "/"}: not allowed'); return
        if '$ref' in s:
            node, r = self._resolve(s['$ref'], root)
            self._v(v, node, r, here, errs, path)
        if 'type' in s:
            ts = s['type'] if isinstance(s['type'], list) else [s['type']]
            if not any(self._type_ok(v, t) for t in ts):
                errs.append(f'{path or "/"}: expected {ts}, got {type(v).__name__}'); return
        if 'const' in s and v != s['const']: errs.append(f'{path or "/"}: expected const {s["const"]!r}')
        if 'enum' in s and v not in s['enum']: errs.append(f'{path or "/"}: {v!r} not in enum')
        if isinstance(v, str):
            if 'pattern' in s and not re.search(s['pattern'], v): errs.append(f'{path or "/"}: {v!r} !~ {s["pattern"]}')
            if 'minLength' in s and len(v) < s['minLength']: errs.append(f'{path or "/"}: shorter than {s["minLength"]}')
            if 'maxLength' in s and len(v) > s['maxLength']: errs.append(f'{path or "/"}: longer than {s["maxLength"]}')
            if s.get('format') == 'date-time' and not re.match(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(Z|[+-]\d\d:\d\d)$', v): errs.append(f'{path or "/"}: bad date-time')
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            if 'minimum' in s and v < s['minimum']: errs.append(f'{path or "/"}: < {s["minimum"]}')
            if 'maximum' in s and v > s['maximum']: errs.append(f'{path or "/"}: > {s["maximum"]}')
        if isinstance(v, list):
            if 'minItems' in s and len(v) < s['minItems']: errs.append(f'{path or "/"}: fewer than {s["minItems"]} items')
            if 'maxItems' in s and len(v) > s['maxItems']: errs.append(f'{path or "/"}: more than {s["maxItems"]} items')
            if 'items' in s:
                for i, it in enumerate(v): self._v(it, s['items'], root, here, errs, f'{path}/{i}')
        if isinstance(v, dict):
            for r in s.get('required', []):
                if r not in v: errs.append(f'{path}/{r}: required')
            props = s.get('properties', {})
            for k, sub in props.items():
                if k in v: self._v(v[k], sub, root, here, errs, f'{path}/{k}')
            ap = s.get('additionalProperties', True)
            for k in v:
                if k not in props:
                    if ap is False: errs.append(f'{path}/{k}: additional property not allowed')
                    elif isinstance(ap, dict): self._v(v[k], ap, root, here, errs, f'{path}/{k}')
            if 'minProperties' in s and len(v) < s['minProperties']: errs.append(f'{path or "/"}: too few properties')
            if 'maxProperties' in s and len(v) > s['maxProperties']: errs.append(f'{path or "/"}: too many properties')
        for sub in s.get('allOf', []): self._v(v, sub, root, here, errs, path)
        if 'anyOf' in s and not any(not self.validate(v, sub, root) for sub in s['anyOf']): errs.append(f'{path or "/"}: matches no anyOf branch')
        if 'oneOf' in s and sum(1 for sub in s['oneOf'] if not self.validate(v, sub, root)) != 1: errs.append(f'{path or "/"}: oneOf mismatch')
        if 'not' in s and not self.validate(v, s['not'], root): errs.append(f'{path or "/"}: matches forbidden schema')
        if 'if' in s:
            if not self.validate(v, s['if'], root):
                if 'then' in s: self._v(v, s['then'], root, here, errs, path)
            elif 'else' in s: self._v(v, s['else'], root, here, errs, path)
