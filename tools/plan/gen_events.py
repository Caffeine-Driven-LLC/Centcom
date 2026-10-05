#!/usr/bin/env python3
"""Generates contracts/04-session-events.md, contracts/schemas/events.schema.json and
contracts/fixtures/events/*.json from one spec table, so prose, schema and fixtures cannot disagree.
Run:  python3 tools/plan/gen_events.py   (then re-lock: python3 tools/plan/lock.py --write)"""
import json, os, re, textwrap
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
C = os.path.join(ROOT, 'contracts')

STATES = sorted(json.load(open(os.path.join(C, 'state-map.json'))).keys())
COLOURS_NOTE = "slot"

# field type mini-language -> (json schema, example)
def ty(t):
    if t == 'str':     return {'type': 'string', 'maxLength': 65536}, 'text'
    if t == 'short':   return {'type': 'string', 'maxLength': 200}, 'short text'
    if t == 'int':     return {'type': 'integer', 'minimum': 0}, 3
    if t == 'bool':    return {'type': 'boolean'}, True
    if t == 'ts':      return {'type': 'string', 'format': 'date-time'}, '2026-10-05T18:07:41.123Z'
    if t == 'b64':     return {'type': 'string', 'pattern': '^[A-Za-z0-9_-]+$'}, 'AAAA'
    if t == 'obj':     return {'type': 'object'}, {}
    if t.startswith('id:'):
        p = t[3:]; return {'type': 'string', 'pattern': '^%s_[0-9A-HJKMNP-TV-Z]{26}$' % p}, p + '_01JA3Z8K2M5N7P9Q0R1S2T3V4W'
    if t.startswith('enum:'):
        vs = t[5:].split('|'); return {'type': 'string', 'enum': vs}, vs[0]
    if t.startswith('list:'):
        s, e = ty(t[5:]); return {'type': 'array', 'items': s, 'maxItems': 200}, [e]
    raise ValueError(t)

def fields_schema(fields):
    props, req, ex = {}, [], {}
    for name, (t, required, _d) in fields.items():
        s, e = ty(t); props[name] = s; ex[name] = e
        if required: req.append(name)
    return {'type': 'object', 'additionalProperties': True, 'properties': props, 'required': req}, ex

F = lambda t, r=True, d='': (t, r, d)
E = 'encrypted'; H = 'hybrid'; P = 'clear'

# (kind, frame t, mode, senders, sequenced, ephemeral, description, clear fields (p), secret fields (ct))
SPEC = [
 # --- conversation
 ('message.user',            'event', E, 'host, editor*', True, False, 'A user prompt entering an agent. In a command post only the host emits it (after approving a queue item, with `queue_item`); in branch mode the agent owner emits it.', {}, {'text': F('str'), 'agent_id': F('id:agt', False), 'queue_item': F('id:que', False), 'attachments': F('list:obj', False), 'reply_to': F('id:msg', False)}),
 ('message.assistant.delta', 'event', E, 'host, editor*', True, False, 'Streaming chunk of an assistant reply. Senders SHOULD coalesce to ≤ 10 frames/s.', {}, {'agent_id': F('id:agt'), 'message_id': F('id:msg'), 'index': F('int'), 'delta': F('str')}),
 ('message.assistant.done',  'event', E, 'host, editor*', True, False, 'End of an assistant reply.', {}, {'agent_id': F('id:agt'), 'message_id': F('id:msg'), 'input_tokens': F('int', False), 'output_tokens': F('int', False)}),
 ('message.system',          'event', E, 'host, editor*', True, False, 'Notices from the runner (compaction, model switch).', {}, {'level': F('enum:info|warn|error'), 'text': F('str')}),
 # --- tools and approvals
 ('tool.request',            'event', E, 'host, editor*', True, False, 'An agent wants to run a tool (display copy).', {}, {'agent_id': F('id:agt'), 'tool_id': F('short'), 'name': F('short'), 'input_summary': F('str'), 'risk': F('enum:low|medium|high')}),
 ('approval.request',        'event', H, 'host, editor*', True, False, 'A human decision is needed. Clear part lets the relay route notifications; detail is encrypted.', {'approval_id': F('id:apr'), 'agent_id': F('id:agt'), 'risk': F('enum:low|medium|high'), 'expires_at': F('ts'), 'approver': F('enum:host|owner|any_editor')}, {'summary': F('str'), 'command': F('str', False), 'cwd': F('str', False)}),
 ('approval.decision',       'event', H, 'host (and delegated approvers)', True, False, 'Answer to an approval request.', {'approval_id': F('id:apr'), 'decision': F('enum:approve|deny'), 'scope': F('enum:once|session|always')}, {'reason': F('str', False)}),
 ('tool.result',            'event', E, 'host, editor*', True, False, 'Outcome of a tool call (display copy).', {}, {'agent_id': F('id:agt'), 'tool_id': F('short'), 'status': F('enum:ok|error|denied|canceled'), 'summary': F('str')}),
 # --- agents and workspace state
 ('agent.spawn',             'event', H, 'host, editor*', True, False, 'A new agent exists. Clear part: id, owner, mode. Secret: label, branch, worktree.', {'agent_id': F('id:agt'), 'owner': F('id:mem'), 'mode': F('enum:command_post|branch')}, {'label': F('short', False), 'branch': F('short', False), 'worktree': F('short', False), 'model': F('short', False)}),
 ('agent.state',            'event', P, 'host, editor*', True, False, f'Product state of an agent. `state` MUST be one of the names in `state-map.json` (CT-STATE-MAP).', {'agent_id': F('id:agt'), 'state': F('enum:' + '|'.join(STATES)), 'since': F('ts')}, {}),
 ('agent.exit',             'event', H, 'host, editor*', True, False, 'An agent finished.', {'agent_id': F('id:agt'), 'outcome': F('enum:ok|error|canceled'), 'error_code': F('short', False)}, {'detail': F('str', False)}),
 ('branch.update',          'event', E, 'host, editor*', True, False, 'Git state of an agent branch.', {}, {'agent_id': F('id:agt'), 'branch': F('short'), 'head': F('short'), 'ahead': F('int'), 'behind': F('int'), 'dirty': F('bool')}),
 ('file.lock',              'event', H, 'host, editor*', True, False, 'Advisory file lock traffic. `path_hmac` = BLAKE2b-MAC(session key, path); the relay arbitrates on the hash only.', {'action': F('enum:acquire|release|deny|expire'), 'path_hmac': F('b64'), 'agent_id': F('id:agt'), 'ttl_ms': F('int', False)}, {'path': F('str', False)}),
 ('agent.handoff',           'event', H, 'host, editor*', True, False, 'Offer, accept or decline handing an agent/task to another member. Clear part drives notifications; the note is encrypted.', {'handoff': F('id:msg'), 'agent_id': F('id:agt'), 'to': F('id:mem'), 'op': F('enum:offer|accept|decline')}, {'note': F('str', False)}),
 ('conflict.detected',      'event', H, 'host, editor*', True, False, 'Two agents touch the same file or merge conflicts.', {'agent_ids': F('list:id:agt'), 'path_hmacs': F('list:b64')}, {'paths': F('list:short', False)}),
 ('diff.share',             'event', E, 'host, editor*', True, False, 'A diff shared for review.', {}, {'agent_id': F('id:agt'), 'files': F('list:obj'), 'blob': F('id:blb', False)}),
 # --- social
 ('reaction',               'event', P, 'host, editor, viewer', True, False, 'Emoji-style reaction to a frame. Codes map to pixel animations in the client.', {'target': F('id:msg'), 'code': F('enum:thumbs|heart|party|laugh|eyes|check'), 'op': F('enum:add|remove')}, {}),
 ('comment.add',            'event', E, 'host, editor, viewer', True, False, 'A comment attached to a frame.', {}, {'target': F('id:msg'), 'text': F('str')}),
 # --- keys (CT-CRYPTO)
 ('key.grant',              'event', H, 'host, editor (key holders)', True, False, 'Sealed session-key grant for one device (CT-CRYPTO §4). `p.kids` says which epochs; the sealed keys are in `ct`.', {'to_device': F('id:dev'), 'kids': F('list:short')}, {'grants': F('list:obj')}),
 # --- queue (t = queue)
 ('queue.submit',           'queue', H, 'editor (host may also)', True, False, 'Add an item to the command-post queue. `id` of the frame is the queue item id (que_).', {'item': F('id:que'), 'size': F('int'), 'kind': F('enum:message|command')}, {'body': F('str'), 'attachments': F('list:obj', False)}),
 ('queue.cancel',           'queue', P, 'the submitter', True, False, 'Submitter withdraws a queued item.', {'item': F('id:que')}, {}),
 ('queue.approve',          'queue', P, 'host', True, False, 'Host approves an item (moves to `approved`).', {'item': F('id:que')}, {}),
 ('queue.reject',           'queue', P, 'host', True, False, 'Host rejects an item.', {'item': F('id:que'), 'code': F('enum:not_now|off_topic|unsafe|duplicate|other')}, {'note': F('str', False)}),
 ('queue.reorder',          'queue', P, 'host', True, False, 'Host sets the order of approved/queued items.', {'order': F('list:id:que')}, {}),
 ('queue.drop',             'queue', P, 'host', True, False, 'Host removes an item.', {'item': F('id:que')}, {}),
 ('queue.claim',            'queue', P, 'host', True, False, 'Host starts running an approved item.', {'item': F('id:que'), 'agent_id': F('id:agt')}, {}),
 ('queue.done',             'queue', P, 'host', True, False, 'Item finished.', {'item': F('id:que'), 'outcome': F('enum:ok|error|canceled')}, {}),
 ('queue.state',            'queue', P, 'server', True, False, 'Authoritative queue snapshot, sent after every change and on join.', {'version': F('int'), 'items': F('list:obj')}, {}),
 # --- control (t = control)
 ('control.kick',           'control', P, 'host', True, False, 'Remove a member from the session.', {'member': F('id:mem'), 'code': F('enum:abuse|inactive|request|other')}, {}),
 ('control.mute',           'control', P, 'host', True, False, 'Silence a member (their queue/message frames are dropped).', {'member': F('id:mem'), 'until': F('ts', False)}, {}),
 ('control.unmute',         'control', P, 'host', True, False, 'Lift a mute.', {'member': F('id:mem')}, {}),
 ('control.role',           'control', P, 'host', True, False, 'Change a member\'s session role.', {'member': F('id:mem'), 'role': F('enum:editor|viewer')}, {}),
 ('control.transfer_host',  'control', P, 'host', True, False, 'Hand the host role to another editor.', {'to': F('id:mem')}, {}),
 ('control.end',            'control', P, 'host', True, False, 'End the session.', {'code': F('enum:done|abandoned|error')}, {}),
 ('control.policy',         'control', P, 'host', True, False, 'Session policy.', {'auto_approve': F('enum:ask|trusted|everyone'), 'share_history': F('bool'), 'queue_limit': F('int'), 'locked': F('bool', False), 'auto_failover': F('bool', False), 'trusted': F('list:id:mem', False), 'approvers': F('list:id:mem', False)}, {}),
 ('control.member_joined',  'control', P, 'server', True, False, 'A member connected for the first time in this session.', {'member': F('id:mem'), 'name': F('short'), 'slot': F('int'), 'role': F('enum:host|editor|viewer'), 'device': F('id:dev')}, {}),
 ('control.member_left',    'control', P, 'server', True, False, 'A member left, was kicked, or timed out.', {'member': F('id:mem'), 'code': F('enum:left|kicked|timeout|revoked')}, {}),
 ('control.roster',         'control', P, 'server', True, False, 'Full roster, sent on join and after bulk changes.', {'version': F('int'), 'members': F('list:obj')}, {}),
 ('control.host_changed',   'control', P, 'server', True, False, 'The host changed (transfer or failover).', {'host': F('id:mem'), 'code': F('enum:transfer|failover')}, {}),
 ('control.session_state',  'control', P, 'server', True, False, 'Lifecycle change.', {'state': F('enum:pending|live|paused|ended|expired')}, {}),
 ('control.rotate_request',  'control', P, 'host', True, False, 'Host asks the relay to announce a new key epoch (scheduled or on request). The relay answers with `control.rotate_key`; keys are chosen by the host (CT-CRYPTO §5).', {'reason': F('enum:scheduled|requested')}, {}),
 ('control.rotate_key',     'control', P, 'server', True, False, 'Key epoch changed (CT-CRYPTO). Members must switch to `kid` for new frames.', {'kid': F('short'), 'reason': F('enum:member_removed|scheduled|requested')}, {}),
 # --- presence (t = presence, ephemeral)
 ('presence.update',        'presence', P, 'any member', False, True, 'Coarse presence. Server coalesces; never replayed.', {'status': F('enum:online|away|busy'), 'activity': F('enum:idle|typing|reviewing|running'), 'agent_count': F('int', False)}, {}),
 ('presence.nudge',         'presence', P, 'editor, host', False, True, 'Poke a member. At most 1 per target per 60 s per sender; the relay drops extras silently.', {'to': F('id:mem')}, {}),
 ('presence.cursor',        'presence', E, 'any member', False, True, 'Cursor / selection in a shared file or transcript. Server throttles to the latest per member every 100 ms.', {}, {'path': F('str', False), 'line': F('int', False), 'col': F('int', False), 'sel_end_line': F('int', False), 'sel_end_col': F('int', False)}),
]

SYS_NOTICES = [('usage_warning', '{pct, resets_at}'), ('quota_reached', '{resets_at}'), ('plan_changed', '{plan}'), ('member_limit_near', '{limit, count}'),
               ('maintenance_soon', '{starts_at, minutes}'), ('client_update_available', '{version, channel}'), ('history_retention_changed', '{days}')]

def build_schema():
    defs, allof = {}, []
    for kind, t, mode, senders, seqd, eph, desc, clear, secret in SPEC:
        key = kind.replace('.', '_')
        if clear:
            s, _ = fields_schema(clear); defs['p_' + key] = s
        if secret:
            s, _ = fields_schema(secret); defs['s_' + key] = s
        rule = {'if': {'properties': {'k': {'const': kind}, 't': {'const': t}}, 'required': ['k', 't']}, 'then': {}}
        then = rule['then']
        if mode == E:
            then['required'] = ['ct']
            then['not'] = {'required': ['p']}
        elif mode == H:
            then['required'] = ['p', 'ct']
        else:
            then['required'] = ['p']
            then['not'] = {'required': ['ct']}
        if clear:
            then['properties'] = {'p': {'$ref': '#/$defs/p_' + key}}
        allof.append(rule)
    return {'$schema': 'https://json-schema.org/draft/2020-12/schema', '$id': 'https://centcom.dev/contracts/events.schema.json',
            'title': 'Centcom session events (frame-level rules per kind)',
            'description': 'Apply AFTER envelope.schema.json. `$defs.p_*` validate cleartext payloads; `$defs.s_*` validate the decrypted secret payload of encrypted/hybrid kinds.',
            '$defs': defs, 'allOf': allof}

def fixtures():
    out = {}
    for kind, t, mode, senders, seqd, eph, desc, clear, secret in SPEC:
        _, pe = fields_schema(clear) if clear else (None, None)
        _, se = fields_schema(secret) if secret else (None, None)
        fr = {'v': 1, 't': t, 'id': 'msg_01JA3Z8K2M5N7P9Q0R1S2T3V4W', 'sid': 'ses_01JA3Z8K2M5N7P9Q0R1S2T3V4W', 'from': 'mem_01JA3Z8K2M5N7P9Q0R1S2T3V4W',
              'ts': '2026-10-05T18:07:41.123Z', 'k': kind}
        if seqd: fr['seq'] = 1042
        if pe is not None and mode != E: fr['p'] = pe
        if mode in (E, H): fr['ct'] = {'alg': 'xchacha20poly1305', 'kid': 'k1', 'n': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'c': 'AAAA'}; fr['sig'] = 'AAAA'
        out[kind] = {'kind': kind, 'frame': fr, 'secret_payload': se}
    return out

def md():
    rows = []
    for kind, t, mode, senders, seqd, eph, desc, clear, secret in SPEC:
        cl = ', '.join('`%s`%s' % (n, '' if r else '?') for n, (_, r, _) in clear.items()) or '—'
        se = ', '.join('`%s`%s' % (n, '' if r else '?') for n, (_, r, _) in secret.items()) or '—'
        rows.append('| `%s` | `%s` | %s | %s | %s | %s | %s |' % (kind, t, {E: 'encrypted', H: 'hybrid', P: 'clear'}[mode], senders, 'yes' if seqd else 'no', cl, se))
    table = '\n'.join(['| Kind | `t` | Mode | Who may send | Seq | Cleartext `p` | Secret (inside `ct`) |', '|---|---|---|---|:-:|---|---|'] + rows)
    details = '\n'.join('- **`%s`**: %s' % (k[0], k[6]) for k in SPEC)
    notices = '\n'.join('| `%s` | `%s` |' % n for n in SYS_NOTICES)
    states = ', '.join('`%s`' % s for s in STATES)
    return TEMPLATE.replace('{{TABLE}}', table).replace('{{DETAILS}}', details).replace('{{NOTICES}}', notices).replace('{{STATES}}', states)

TEMPLATE = open(os.path.join(os.path.dirname(__file__), 'events_template.md')).read()

if __name__ == '__main__':
    os.makedirs(os.path.join(C, 'fixtures', 'events'), exist_ok=True)
    open(os.path.join(C, '04-session-events.md'), 'w').write(md())
    json.dump(build_schema(), open(os.path.join(C, 'schemas', 'events.schema.json'), 'w'), indent=2)
    for k, v in fixtures().items():
        json.dump(v, open(os.path.join(C, 'fixtures', 'events', k + '.json'), 'w'), indent=2)
    print(len(SPEC), 'event kinds written')
