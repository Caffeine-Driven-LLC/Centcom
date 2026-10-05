"""UI-state animations: session/agent states, files, git + CI, system, team, billing, onboarding."""
import cento_lib as L
from cento_lib import f, STATIC, DYN, text_rows
from animations import reg, lap, bub, txt, conf

STATIC.update({
    'file':     ["wwwwg.", "wuuuww", "wwwwww", "wuuuuw", "wwwwww", "wuuuww", "wwwwww"],
    'folder':   ["YYY.....", "YYYYYYYY", "YYYYYYYY", "YYYYYYYY", "OOOOOOOO"],
    'trash':    ["..ggg", "ggggg", "g.g.g", "g.g.g", "g.g.g", "ggggg"],
    'trash_open': ["gggg.", "ggggg", "g.g.g", "g.g.g", "g.g.g", "ggggg"],
    'shield':   ["bbbbb", "bbwbb", "bbwbb", "bbwbb", ".bbb.", "..b.."],
    'shield_x': ["bbbbb", "brbrb", "bbrbb", "brbrb", ".bbb.", "..b.."],
    'shield_ok': ["bbbbb", "bbbbG", "bGbGb", "bbGbb", ".bbb.", "..b.."],
    'shield_crack': ["bbbbb", "bbwbb", "bwbbb", "bbwbb", ".bwb.", "..b.."],
    'coin':     [".YY.", "YOOY", "YOOY", ".YY."],
    'bell':     ["..Y..", ".YYY.", ".YYY.", "YYYYY", "YYYYY", "..Y.."],
    'plug':     ["c...c", "c...c", "ccccc", ".ccc.", "..c..", "..c.."],
    'plug_l':   ["c...c", "c...c", "ccccc", ".ccc."],
    'plug_r':   ["..c..", "..c..", "c...c"[:5]],
    'puzzle':   ["..v..", "vvvvv", "vvvvv", "vvvvv", "vvvvv"],
    'brain':    [".pp.pp", "pppppp", "pppppp", ".pppp.", "..pp.."],
    'floppy':   ["bbbbb", "bwwwb", "bbbbb", "bbbbb", "bkkkb"],
    'clipboard': ["..g..", "wwwww", "wuuuw", "wwwww", "wuuuw", "wwwww", "wwwww"],
    'camera':   ["..ggg..", "ggggggg", "gg.k.gg", "ggkkkgg", "ggggggg"],
    'chart':    ["....c..", "....c..", "..c.c..", "..c.c.c", "c.c.c.c", "ccccccc"],
    'lightning': ["..YY", ".YY.", "YYYY", "..YY", ".Y..", "Y..."],
    'pin':      ["rrr", "rrr", ".r.", ".r."],
    'key':      ["YYY....", "Y.YYYYY", "YYY.Y.Y"],
    'eye':      [".wwwww.", "wwkkkww", ".wwwww."],
    'diff':     ["rrrr.....", "....GGGG.", "wwwwwwwww", "rrr......", "...GGGGG."],
    'traffic_r': ["uuu", "uru", "uuu", "uuu", "uuu", "uuu", "uuu"],
    'traffic_y': ["uuu", "uuu", "uuu", "uYu", "uuu", "uuu", "uuu"],
    'traffic_g': ["uuu", "uuu", "uuu", "uuu", "uuu", "uGu", "uuu"],
    'toggle_off': ["uuuuuuu", "uwuuuuu", "uuuuuuu"],
    'toggle_on': ["GGGGGGG", "GGGGGwG", "GGGGGGG"],
    'wrench':   ["...gg", "..gg.", ".N...", "N....", "N...."],
    'link':     ["cc..cc", "cccccc", "cc..cc"],
    'play':     ["w...", "ww..", "www.", "ww..", "w..."],
    'pause':    ["ww.ww"] * 5,
    'stop':     ["rrrrr"] * 5,
    'card':     ["bbbbbbbb", "bYYbbbbb", "bbbbbbbb", "bwwwwbbb", "bbbbbbbb"],
    'cherry':   [".N.N.", "N...N", "rr.rr", "rr.rr"],
    'dot_g':    ["GG", "GG"], 'dot_r': ["rr", "rr"], 'dot_y2': ["YY", "YY"],
    'badge':    [".Y.Y.", "YYYYY", ".YYY.", "..r..", ".r.r."],
    'cloud_up': ["..www..", ".wwwww.", "wwwwwww", ".wwwww."],
    'empty_box': ["N.....N", "NN...NN", "N.....N", "NNNNNNN", "N.....N", "NNNNNNN"],
    'cobweb':   ["g.g.g", ".ggg.", "g.g.."],
    'hardhat':  [".YYYY.", "YYYYYY", "OOOOOO"],
})
STATIC['plug_r'] = ["..c..", "..c..", "c...c"[:5]]


def p_input(t=0, s=''):
    w, rows = 28, []
    rows.append('g' * w)
    tr = text_rows(s, 'w') if s else ['.' * 0] * 5
    cur = 'w' if t % 2 == 0 else 'u'
    x = 2 + (len(s) * 4 - 1 if s else 0)
    for r in range(5):
        line = ['u'] * (w - 2)
        if s:
            for j, ch in enumerate(tr[r]):
                if ch != '.': line[1 + j] = ch
        if r in (1, 2, 3):
            line[x - 1] = cur
        rows.append('g' + ''.join(line) + 'g')
    rows.append('g' * w)
    return rows


def p_stream(n=0, w=16):
    rows = []
    for i in range(3):
        k = max(0, min(w - 2, n - (w - 2) * i))
        rows.append('w' * k + '.' * (w - 2 - k))
        rows.append('.' * (w - 2))
    return rows[:5]


def p_waves(t=0):
    hs = [[1, 3, 5, 3, 1], [2, 5, 3, 5, 2], [3, 2, 5, 2, 3], [1, 4, 2, 4, 1]][t % 4]
    rows = [['.'] * 9 for _ in range(5)]
    for i, h in enumerate(hs):
        for k in range(h):
            rows[4 - k][i * 2] = 'c'
    return [''.join(r) for r in rows]


def p_count(n, color='Y'):
    return text_rows(str(n), color)


DYN.update({'input': p_input, 'stream': p_stream, 'waves': p_waves, 'count': p_count})


def pill(label, color, ink='u', dx=0, dy=-9):
    return ('bubble', dx, dy, label, 'x', color, ink)


# ================================================================ SESSION
C = 'ui_session'
reg(C, 'session_start', [f(300, e='closed', m='flat', lg='tuck'), f(150, e='squint', m='flat'), f(300, e='open', m='smile', p=[('twinkle', 13, -2)]), f(350, e='happy', m='grin', ar='up', p=[('spark_s', 14, 0), pill('READY', 'G', 'u', 6, -8)])], 'A session boots up.')
reg(C, 'ready_prompt', [f(500, e='right', m='flat', ar='far', p=[('input', 14, 5, i, '')]) for i in range(4)], 'Waiting at the prompt, cursor blinking.')
reg(C, 'prompt_typing', [f(180, e='down', m='small', p=[('input', 14, 5, i, 'HELLO'[:min(5, i + 1)])]) for i in range(6)], 'Someone is typing a prompt.')
reg(C, 'prompt_received', [f(160, e='open', p=[('envelope', 4, -14 + i * 4)]) for i in range(3)] + [f(200, e='ring', m='open', p=[('envelope', 4, -2)]), f(350, e='star', m='smile', ar='up', p=[('twinkle', 13, -2)])], 'A message arrives.')
reg(C, 'streaming_response', [f(150, e='down', m='open' if i % 2 else 'small', ar='far', p=[('stream', 14, 3, i * 2, 16)]) for i in range(12)], 'Text streaming in.')
reg(C, 'tool_running', [f(160, e='right', m='small', ar='far' if i % 2 else 'out', p=[lap('term', i), ('gear' if i % 2 else 'spark_s', 28, 1)]) for i in range(6)], 'A tool call is executing.')
reg(C, 'plan_mode', [f(350, e='right', m='small', acc=['glasses'], p=[('clipboard', 14, 3), txt('PLAN', 12, -8, 'c')]), f(350, e='down', m='small', acc=['glasses'], ar='far', p=[('clipboard', 14, 3), ('pencil', 11, 5), txt('PLAN', 12, -8, 'c')]), f(350, e='right', m='smile', acc=['glasses'], p=[('clipboard', 14, 3), ('check', 15, 5), txt('PLAN', 12, -8, 'c')])], 'Plan mode: think first, edit later.')
reg(C, 'accept_edits', [f(300, e='right', m='flat', p=[('diff', 14, 3)]), f(300, e='happy', m='smile', ar='up', p=[('diff', 14, 3), ('check', 24, 1)]), f(300, e='happy', m='grin', ar='up', p=[('diff', 14, 3), ('check', 24, 1), ('spark_s', 12, -1)])], 'Edits accepted.')
reg(C, 'interrupt_stop', [f(200, e='ring', m='open', al='high', ar='high', p=[('stopsign', 14, -2)]), f(200, e='angry', m='flat', al='high', ar='high', p=[('stopsign', 14, -2), txt('STOP', 0, -8, 'r')]), f(300, e='squint', m='flat', al='out', ar='out', p=[('stopsign', 14, -2)])], 'Hold on, stop everything.')
reg(C, 'resume_session', [f(350, e='closed', m='small', p=[('hourglass', 15, 3, 1)]), f(250, e='open', m='flat', p=[('play', 15, 3)]), f(350, e='happy', m='smile', ar='up', p=[('play', 15, 3), ('twinkle', 12, -2)])], 'Picking up where we left off.')
reg(C, 'session_saved', [f(250, e='open', ar='far', p=[('floppy', 14, 2 + i % 2)]) for i in range(2)] + [f(400, e='happy', m='smile', ar='far', p=[('floppy', 14, 2), ('check', 20, 0)])], 'Session saved.')
reg(C, 'new_session', [f(200, e='closed', m='flat', y=2), f(200, e='open', m='small', y=1, p=[('spark_s', 13, 0)]), f(250, e='star', m='grin', y=0, p=[('spark', 13, -1), ('twinkle', -4, 1)]), f(350, e='happy', m='smile', ar='up', p=[pill('NEW', 'c', 'u', 8, -8)])], 'A fresh session.')
reg(C, 'model_switch', [f(250, e='left', p=[('brain', 14, 2)]), f(150, e='ring', m='open', p=[('twinkle', 14, 1), ('twinkle', 18, 3)]), f(250, e='right', p=[('brain', 14, 2), ('spark_s', 20, 0)]), f(300, e='star', m='smile', p=[('brain', 14, 2), ('check', 22, 0)])], 'Swapping models.')
reg(C, 'voice_listening', [f(180, e='open', m='small', p=[('mic', 14, 1), ('waves', 18, 2, i)]) for i in range(8)], 'Listening to voice input.')
reg(C, 'speaking', [f(150, e='happy', m='open' if i % 2 else 'smile', p=[('note', 14, -1 - i % 3), ('waves', 14, 3, i)]) for i in range(8)], 'Reading the answer aloud.')
reg(C, 'token_counter', [f(180, e='up', m='small', p=[('coin', 14, 2), ('count', 19, 2, n)]) for n in (3, 18, 42, 97, 128)], 'Tokens ticking up.')
reg(C, 'cost_alert', [f(220, e='ring', m='open', p=[('coin', 14, 1), txt('!', 20, 0, 'r')]), f(220, e='ring', m='gasp', acc=['sweat'], p=[('coin', 14, 1), ('coin', 20, 3), txt('!', 26, 0, 'r')]), f(300, e='x', m='zig', acc=['sweat'], p=[('coin', 14, 1), ('coin', 20, 3), ('coin', 17, 6), txt('!', 26, 0, 'r')])], 'The bill is getting big.')
reg(C, 'quota_reached', [f(300, e='squint', m='flat', p=[('progress', 14, 2, 14, 0.8)]), f(300, e='ring', m='open', p=[('progress', 14, 2, 14, 1.0, 'r'), txt('MAX', 14, -4, 'r')]), f(300, e='sad', m='frown', acc=['sweat'], p=[('progress', 14, 2, 14, 1.0, 'r'), txt('MAX', 14, -4, 'r')])], 'Usage limit hit.')
reg(C, 'background_task', [f(250, e='right', m='smile', ar='far' if i % 2 else 'out', p=[lap('code', i), ('spinner', 28, -1, i)]) for i in range(8)], 'Working while a task runs in the background.')
reg(C, 'notification', [f(120, e='ring', m='open', p=[('bell', 13 + (i % 2), -2)]) for i in range(2)] * 2 + [f(300, e='happy', m='smile', p=[('bell', 13, -2), txt('1', 13, -9, 'r')])], 'Ding!')
reg(C, 'update_available', [f(300, e='up', m='small', p=[('arrow_up', 14, -6 - i % 2), ('gift', 14, 3)]) for i in range(3)] + [f(300, e='star', m='grin', ar='up', p=[('arrow_up', 14, -7), ('gift', 14, 3), ('spark_s', 20, -1)])], 'A new version is ready.')
reg(C, 'first_run_welcome', [f(250, e='open', m='smile', al='upw', p=[bub('HELLO', 8, -9)]), f(250, e='happy', m='smile', al='up', p=[bub('HELLO', 8, -9)]), f(250, e='happy', m='grin', al='upw', ar='up', p=[bub('HELLO', 8, -9), ('spark_s', -4, 0), ('spark_s', 14, 1)]), f(300, e='happy', m='grin', al='up', ar='upw', p=[conf(2, 5)])], 'First launch greeting.')
reg(C, 'empty_state', [f(500, e='left', m='small', p=[('empty_box', 14, 6), ('cobweb', 14, 5)]), f(500, e='right', m='flat', p=[('empty_box', 14, 6), ('cobweb', 14, 5), txt('?', 17, -1, 'Y')]), f(500, e='down', m='frown', p=[('empty_box', 14, 6), ('cobweb', 14, 5)])], 'Nothing here yet.')
reg(C, 'no_results', [f(300, e='left', m='small', ar='far', p=[('magnifier', 14, 3), txt('0', 22, 3, 'r')]), f(300, e='right', m='zig', ar='far', p=[('magnifier', 15, 3), txt('0', 22, 3, 'r')]), f(300, e='sad', m='frown', p=[('magnifier', 14, 3), txt('0', 22, 3, 'r')])], 'Search found nothing.')
reg(C, 'search_found', [f(250, e='left', ar='far', p=[('magnifier', 14, 3)]), f(250, e='right', ar='far', p=[('magnifier', 16, 3)]), f(400, e='star', m='grin', ar='up', p=[('magnifier', 14, 3), ('check', 21, 2), ('twinkle', 12, -2)])], 'Found it.')
reg(C, 'offline', [f(300, e='up', m='frown', p=[('wifi', 4, -10), ('xmark_s', 12, -9)]), f(300, e='sad', m='frown', p=[('plug_l', 14, 4), ('plug_r', 20, 8), ('xmark_s', 18, 0)])], 'No connection.')
reg(C, 'reconnecting', [f(250, e='up', m='small', p=[('spinner', 4, -8, i * 2), ('plug_l', 14, 4), ('plug_r', 19 - min(i, 3), 5)]) for i in range(6)], 'Trying to reconnect.')
reg(C, 'back_online', [f(250, e='up', m='small', p=[('wifi', 4, -10)]), f(300, e='happy', m='smile', ar='up', p=[('wifi', 4, -10), ('check', 14, -6)]), f(300, e='happy', m='grin', ar='up', al='up', p=[('wifi', 4, -10), ('check', 14, -6), ('spark_s', -4, -3)])], 'Connection restored.')
reg(C, 'auth_needed', [f(300, e='right', m='flat', p=[('lock', 15, 4), ('key', 14, 0)]), f(300, e='up', m='small', ar='far', p=[('lock', 15, 4), ('key', 15, 2)])], 'Please sign in.')
reg(C, 'logged_in', [f(250, e='right', ar='far', p=[('lock', 15, 4), ('key', 14, 4)]), f(300, e='happy', m='smile', ar='far', p=[('key', 14, 4), ('check', 21, 1)]), f(300, e='happy', m='grin', ar='up', p=[('check', 21, 1), ('spark_s', 12, -1)])], 'Signed in.')
reg(C, 'session_expired', [f(350, e='squint', m='flat', p=[('hourglass', 15, 3, 1)]), f(350, e='ring', m='open', acc=['sweat'], p=[('lock', 15, 4), txt('!', 22, 0, 'r')]), f(350, e='sad', m='frown', p=[('lock', 15, 4)])], 'Time ran out, sign in again.')
reg(C, 'maintenance', [f(220, e='right', m='small', acc=[], ar='far' if i % 2 else 'out', p=[('wrench', 14, 6 - i % 2), ('gear', 22, 2), ('hardhat', 3, -2)]) for i in range(4)], 'Down for maintenance.')

# ================================================================ FILES
C = 'ui_files'
reg(C, 'reading_file', [f(300, e=e, acc=['glasses'], m='small', p=[('file', 14, 3)]) for e in ('right', 'down', 'right', 'down')], 'Reading a file.')
reg(C, 'editing_file', [f(200, e='down', m='small', ar='far', p=[('file', 14, 3), ('pencil', 11 + i % 2, 4 + i % 2)]) for i in range(4)], 'Editing a file.')
reg(C, 'creating_file', [f(200, e='up', m='small', p=[('twinkle', 16, 3)]), f(200, e='ring', m='open', p=[('spark_s', 16, 2), ('file', 15, 5)]), f(300, e='star', m='grin', ar='far', p=[('file', 14, 3), ('spark', 21, -1)])], 'A new file appears.')
reg(C, 'deleting_file', [f(300, e='right', ar='far', p=[('file', 14, 2), ('trash_open', 24, 3)]), f(200, e='right', ar='far', p=[('file', 19, 3), ('trash_open', 24, 3)]), f(200, e='open', m='small', p=[('trash', 24, 3), ('puff', 22, 0)]), f(350, e='squint', m='smile', p=[('trash', 24, 3)])], 'Into the trash it goes.')
reg(C, 'moving_file', [f(200, e='right', ar='far', p=[('folder', 14, 4), ('file', 16, 0), ('folder', 28, 4)]), f(200, e='right', ar='far', p=[('folder', 14, 4), ('file', 22, -1), ('folder', 28, 4)]), f(250, e='right', ar='out', p=[('folder', 14, 4), ('file', 29, 1), ('folder', 28, 4)]), f(350, e='happy', m='smile', p=[('folder', 14, 4), ('folder', 28, 4), ('check', 31, -3)])], 'Moving a file between folders.')
reg(C, 'grep_search', [f(200, e='left' if i % 2 else 'right', ar='far', p=[('folder', 14, 6), ('magnifier', 14 + (i * 2) % 8, 1), ('file', 24, 4)]) for i in range(6)], 'Searching across files.')
reg(C, 'file_saved', [f(200, e='open', p=[('file', 14, 3)]), f(200, e='happy', p=[('file', 14, 3), ('floppy', 21, 1)]), f(350, e='happy', m='smile', ar='up', p=[('file', 14, 3), ('floppy', 21, 2), ('check', 22, -2)])], 'Saved.')
reg(C, 'diff_review', [f(300, e=e, acc=['glasses'], p=[('diff', 14, 3)] + ([('check', 24, 0)] if e == 'right' else [('xmark_s', 24, 0)])) for e in ('down', 'right', 'down', 'right')], 'Reviewing a diff.')
reg(C, 'applying_patch', [f(220, e='right', ar='far', p=[('diff', 14 + i * 2, 1), ('file', 28, 3)]) for i in range(4)] + [f(400, e='happy', m='smile', p=[('file', 28, 3), ('spark_s', 27, 0), ('check', 24, 6)])], 'Applying a patch.')
reg(C, 'file_upload', [f(220, e='up', m='small', ar='far', p=[('file', 14, 3 - i), ('cloud_up', 14, -14), ('arrow_up', 18, -6 - i)]) for i in range(4)], 'Uploading a file to the cloud.')
reg(C, 'screenshot', [f(300, e='right', m='smile', ar='up', p=[('camera', 14, 3)]), f(100, e='ring', m='open', ar='up', p=[('camera', 14, 3), ('spark', 12, -4), ('spark', 22, 0)]), f(350, e='happy', m='grin', ar='up', p=[('camera', 14, 3), ('twinkle', 12, -3)])], 'Snap!')
reg(C, 'clipboard_copy', [f(250, e='right', ar='far', p=[('clipboard', 14, 3)]), f(350, e='happy', m='smile', ar='far', p=[('clipboard', 14, 3), pill('COPIED', 'G', 'u', 6, -8)])], 'Copied to clipboard.')
reg(C, 'format_code', [f(200, e='right', ar='far' if i % 2 else 'out', p=[lap('code', i * 3), ('twinkle', 19 + i * 2, 4 - i % 2)]) for i in range(5)], 'Tidying the code.')
reg(C, 'file_locked', [f(300, e='right', p=[('file', 14, 3), ('lock', 16, 5)]), f(300, e='ring', m='open', p=[('file', 14, 3), ('lock', 16, 5), ('xmark_s', 22, 1)]), f(300, e='sad', m='frown', p=[('file', 14, 3), ('lock', 16, 5)])], 'Someone else has this file locked.')
reg(C, 'permission_prompt', [f(300, e='up', m='small', p=[('shield', 14, 0), bub('ALLOW', 8, -9)]), f(300, e='right', m='small', p=[('shield', 14, 0), bub('ALLOW', 8, -9)]), f(300, e='up', m='small', p=[('shield', 14, 0), bub('ALLOW', 8, -9)])], 'Asking before touching anything.')
reg(C, 'folder_open', [f(300, e='right', p=[('folder', 14, 6)]), f(300, e='ring', m='open', p=[('folder', 14, 6), ('file', 15, 1), ('file', 20, 2)]), f(400, e='happy', m='smile', p=[('folder', 14, 6), ('file', 15, 1), ('file', 20, 2), ('twinkle', 25, 0)])], 'Opening a folder.')
reg(C, 'archive_zip', [f(220, e='down', m='small', ar='far', p=[('file', 14, 2 + i), ('box', 13, 8)]) for i in range(3)] + [f(350, e='happy', m='smile', p=[('box', 13, 8), ('check', 18, 3)])], 'Packing files up.')

# ================================================================ GIT
C = 'ui_git'
reg(C, 'branch_create', [f(300, e='right', p=[('branch', 16, 1, i)]) for i in range(3)] + [f(350, e='star', m='smile', ar='up', p=[('branch', 16, 1, 2), ('spark_s', 24, 0)])], 'A new branch forks off.')
reg(C, 'branch_switch', [f(200, x=-2, e='left', p=[('branch', 16, 1, 1)]), f(150, x=0, e='ring', m='open', lg='tuck', y=-2, p=[('branch', 16, 1, 1)]), f(250, x=4, e='right', p=[('branch', 16, 1, 1)])], 'Hopping to another branch.')
reg(C, 'worktree_spawn', [f(250, e='open', fr=None, p=[('twinkle', 17, 4)]), f(200, e='ring', fr=dict(e='none', m='none'), p=[('spark_s', 17, 2), ('spark_s', 24, 6)]), f(300, e='happy', m='smile', fr=dict(e='open', m='smile', al='upw')), f(400, e='happy', m='grin', fr=dict(e='happy', m='grin', al='up'), p=[('branch', 8, -12, 2)])], 'A second worktree, a second Cento.')
reg(C, 'pr_open', [f(250, e='right', ar='far', p=[('gift', 15, 6)]), f(250, e='up', ar='up', p=[('gift', 15, 6), ('envelope', 16, 0)]), f(350, e='happy', m='grin', ar='up', p=[pill('PR', 'c', 'u', 6, -8), ('arrow_up', 16, -4)])], 'Pull request opened.')
reg(C, 'pr_review_requested', [f(260, e='right', p=[('bell', 14, -2)], fr=dict(e='left', m='small', acc=['glasses'])), f(260, e='right', p=[('bell', 15, -2)], fr=dict(e='down', m='small', acc=['glasses'])), f(260, e='right', p=[('bell', 14, -2)], fr=dict(e='right', m='small', acc=['glasses']))], 'Waiting on a reviewer.')
reg(C, 'pr_approved', [f(260, e='right', fr=dict(e='left', m='smile')), f(300, e='happy', m='smile', fr=dict(e='happy', m='grin', ar='up'), p=[('check', 14, -3)]), f(400, e='happy', m='grin', ar='up', fr=dict(e='happy', m='grin', ar='up'), p=[('check', 14, -3), ('spark_s', 12, -1)])], 'Approved!')
reg(C, 'pr_merged', [f(200, e='right', p=[('branch', 16, 1, i)]) for i in range(4)] + [f(300, e='star', m='grin', al='cheer', ar='cheer', p=[('branch', 16, 1, 3), conf(1, 6)]), f(300, e='happy', m='grin', al='cheer', ar='cheer', y=-1, p=[('branch', 16, 1, 3), conf(3, 6)])], 'Merged and shipped.')
reg(C, 'ci_running', [f(220, e='right', m='small', p=[('traffic_y', 15, 1), ('spinner', 20, 2, i)]) for i in range(8)], 'CI is running.')
reg(C, 'ci_passed', [f(250, e='right', m='small', p=[('traffic_y', 15, 1)]), f(350, e='happy', m='smile', p=[('traffic_g', 15, 1), ('check', 20, 1)]), f(300, e='happy', m='grin', al='cheer', ar='cheer', y=-1, lg='tuck', p=[('traffic_g', 15, 1), ('check', 20, 1), ('spark_s', 12, -3)])], 'Green build.')
reg(C, 'ci_failed', [f(250, e='right', m='small', p=[('traffic_y', 15, 1)]), f(350, e='sad', m='frown', p=[('traffic_r', 15, 1), ('xmark_s', 20, 2)]), f(350, e='x', m='zig', acc=['sweat'], p=[('traffic_r', 15, 1), ('xmark', 20, 1)])], 'Red build.')
reg(C, 'git_stash', [f(220, e='right', ar='far', p=[('file', 14, 2 + i * 2), ('box', 20, 6)]) for i in range(3)] + [f(350, e='happy', m='smile', p=[('box', 20, 6), ('check', 24, 2)])], 'Stashing changes away.')
reg(C, 'rebase', [f(250, e='squint', m='zig', acc=['sweat'], p=[('branch', 16, 1, 1 + i % 3), ('spinner', 28, 0, i * 2)]) for i in range(6)], 'Rebasing, hold your breath.')
reg(C, 'conflict_resolved', [f(250, e='ring', m='open', p=[('branch', 16, 1, 3), ('xmark', 28, 0)]), f(250, e='squint', m='small', ar='far', p=[('branch', 16, 1, 3), ('xmark_s', 28, 1)]), f(400, e='happy', m='grin', ar='up', p=[('branch', 16, 1, 3), ('check', 28, 0), ('spark_s', 12, -2)])], 'Conflict gone.')
reg(C, 'release_tag', [f(250, e='up', m='small', p=[('flag', 14, 2)]), f(300, e='happy', m='smile', ar='up', p=[('flag', 14, 2), txt('V1', 21, 0, 'Y')]), f(400, e='happy', m='grin', al='cheer', ar='cheer', p=[('flag', 14, 2), txt('V1', 21, 0, 'Y'), conf(2, 7)])], 'Tagged a release.')
reg(C, 'rollback', [f(200, e='ring', m='open', p=[txt('<<', 14, 0, 'r'), ('hourglass', 22, 3, 1)]), f(200, e='left', m='small', x=-1, p=[txt('<<', 14, 0, 'r')]), f(200, e='left', m='small', x=-2, p=[txt('<<', 14, 0, 'r')]), f(350, e='happy', m='smile', p=[('check', 14, 0)])], 'Rolling back.')
reg(C, 'cherry_pick', [f(250, e='up', ar='up', p=[('cherry', 12, -6)]), f(250, e='up', ar='up', p=[('cherry', 12, -4)]), f(350, e='happy', m='grin', ar='far', p=[('cherry', 14, 5)])], 'Cherry-picking a commit.')
reg(C, 'git_blame', [f(250, e='right', m='flat', ar='far', p=[('magnifier', 15, 3)], fr=dict(e='ring', m='open', acc=['sweat'])), f(250, e='angry', m='flat', ar='far', p=[txt('WHO', 14, -6, 'r')], fr=dict(e='ring', m='open', acc=['sweat'])), f(300, e='squint', m='small', fr=dict(e='sad', m='zig', acc=['sweat', 'blush']))], 'Who wrote this?')

# ================================================================ SYSTEM + TEAM
C = 'ui_system'
reg(C, 'settings', [f(220, e='down', m='small', ar='far', p=[('gear', 14, 2), ('wrench', 21 - i % 2, 4)]) for i in range(4)], 'Tweaking settings.')
reg(C, 'theme_dark', [f(350, e='squint', m='frown', p=[('sun', 14, -4), ('toggle_off', 14, 8)]), f(250, e='ring', m='open', p=[('toggle_on', 14, 8), ('twinkle', 16, 3)]), f(450, e='happy', m='smile', acc=['sunglasses'], p=[('moon', 14, -4), ('toggle_on', 14, 8)])], 'Switching to dark mode.')
reg(C, 'theme_light', [f(350, e='happy', m='smile', acc=['sunglasses'], p=[('moon', 14, -4), ('toggle_on', 14, 8)]), f(250, e='ring', m='open', p=[('toggle_off', 14, 8), ('spark', 17, 3)]), f(450, e='squint', m='grin', p=[('sun', 14, -4), ('toggle_off', 14, 8)])], 'Switching to light mode.')
reg(C, 'upgrade_pro', [f(250, e='up', m='small', ar='up'), f(250, e='star', m='smile', acc=['crown'], ar='up', p=[('twinkle', -4, -2)]), f(400, e='star', m='grin', acc=['crown'], al='cheer', ar='cheer', y=-1, p=[pill('PRO', 'Y', 'u', 6, -9), ('spark_s', -5, -1), ('spark_s', 14, 0)])], 'Upgraded to Pro.')
reg(C, 'payment_success', [f(250, e='right', p=[('card', 14, 4)]), f(350, e='happy', m='smile', ar='up', p=[('card', 14, 4), ('check', 22, 2)]), f(300, e='happy', m='grin', al='cheer', ar='cheer', y=-1, p=[('card', 14, 4), ('check', 22, 2), conf(1, 8)])], 'Payment went through.')
reg(C, 'payment_failed', [f(250, e='right', p=[('card', 14, 4)]), f(350, e='sad', m='frown', p=[('card', 14, 4), ('xmark_s', 23, 5)]), f(350, e='x', m='zig', acc=['sweat'], p=[('card', 14, 4), ('xmark', 23, 3)])], 'Card declined.')
reg(C, 'role_admin', [f(350, e='happy', m='smile', acc=['crown'], p=[pill('ADMIN', 'Y', 'u', 4, -9)]), f(350, e='star', m='grin', acc=['crown'], al='flex', ar='flex', p=[pill('ADMIN', 'Y', 'u', 4, -9), ('twinkle', -4, 3)])], 'Admin badge.')
reg(C, 'role_viewer', [f(400, e='right', m='small', acc=['glasses'], p=[pill('VIEW', 'g', 'w', 4, -9)]), f(400, e='left', m='small', acc=['glasses'], p=[pill('VIEW', 'g', 'w', 4, -9), ('eye', 14, 0)])], 'View-only access.')
reg(C, 'role_editor', [f(300, e='down', m='small', ar='far', p=[pill('EDIT', 'c', 'u', 4, -9), ('pencil', 11, 5)]), f(300, e='down', m='small', ar='out', p=[pill('EDIT', 'c', 'u', 4, -9), ('pencil', 12, 6)])], 'Editor access.')
reg(C, 'permission_granted', [f(300, e='right', p=[('shield', 14, 2)]), f(350, e='happy', m='smile', ar='up', p=[('shield_ok', 14, 2), ('twinkle', 12, -2)])], 'Access granted.')
reg(C, 'permission_revoked', [f(300, e='right', p=[('shield', 14, 2)]), f(350, e='sad', m='frown', p=[('shield_x', 14, 2)])], 'Access revoked.')
reg(C, 'security_scan', [f(220, e='right', ar='far', p=[('shield', 20, 2), ('magnifier', 14 + i * 2, 1)]) for i in range(4)] + [f(400, e='happy', m='smile', ar='up', p=[('shield_ok', 20, 2), ('twinkle', 12, -2)])], 'Scanning for problems.')
reg(C, 'vulnerability_found', [f(220, e='right', p=[('shield', 16, 2)]), f(220, e='ring', m='gasp', p=[('shield_crack', 16, 2), ('bug', 24, 3)]), f(300, e='x', m='gasp', acc=['sweat'], tip='R', p=[('shield_crack', 16, 2), ('bug', 24, 3), txt('!', 12, -4, 'r')])], 'A hole in the shield.')
reg(C, 'backup', [f(250, e='up', m='small', p=[('cloud', 14, -8), ('floppy', 16, 4)]), f(250, e='up', m='small', p=[('cloud', 14, -8), ('floppy', 16, 1), ('arrow_up', 18, -3)]), f(400, e='happy', m='smile', p=[('cloud', 14, -8), ('check', 18, -2)])], 'Backed up to the cloud.')
reg(C, 'api_key_copied', [f(250, e='right', p=[('key', 14, 3), ('clipboard', 22, 1)]), f(400, e='happy', m='smile', ar='far', p=[('key', 14, 3), ('clipboard', 22, 1), ('check', 29, 0)])], 'API key copied.')
reg(C, 'mcp_connected', [f(250, e='right', p=[('plug_l', 14, 4), ('plug_r', 22, 5)]), f(200, e='ring', m='open', p=[('plug_l', 14, 4), ('plug_r', 19, 5)]), f(400, e='happy', m='grin', ar='up', p=[('plug_l', 14, 4), ('plug_r', 15, 5), ('spark_s', 21, 1), ('check', 22, 6)])], 'An MCP server plugs in.')
reg(C, 'mcp_disconnected', [f(300, e='happy', m='smile', p=[('plug_l', 14, 4), ('plug_r', 15, 5)]), f(250, e='ring', m='open', p=[('plug_l', 14, 4), ('plug_r', 19, 5)]), f(350, e='sad', m='frown', p=[('plug_l', 14, 4), ('plug_r', 24, 6), ('xmark_s', 20, 2)])], 'MCP server dropped.')
reg(C, 'skill_loaded', [f(250, e='up', m='small', ar='up', p=[('puzzle', 14, -6)]), f(250, e='right', m='small', ar='far', p=[('puzzle', 15, 2)]), f(400, e='star', m='grin', ar='up', p=[('puzzle', 15, 2), ('spark', 21, -1), ('check', 22, 6)])], 'A skill snaps into place.')
reg(C, 'memory_saved', [f(300, e='up', m='small', p=[('brain', 14, 2)]), f(300, e='closed', m='smile', p=[('brain', 14, 2), ('floppy', 21, 4)]), f(400, e='happy', m='smile', p=[('brain', 14, 2), ('check', 21, 0), ('twinkle', 12, -2)])], 'Remembering this for later.')
reg(C, 'hook_fired', [f(150, e='open', p=[('lightning', 14, -2)]), f(150, e='ring', m='open', p=[('lightning', 14, -2), ('spark_s', 19, 0)]), f(350, e='happy', m='smile', p=[('lightning', 14, -2), ('check', 20, 3)])], 'A hook ran.')
reg(C, 'achievement', [f(250, e='ring', m='open', p=[('badge', 14, -1)]), f(300, e='star', m='grin', ar='up', al='up', p=[('badge', 14, -1), pill('WIN', 'Y', 'u', 4, -9), ('spark_s', -5, 2)]), f(400, e='star', m='grin', ar='up', al='up', y=-1, p=[('badge', 14, -1), pill('WIN', 'Y', 'u', 4, -9), conf(2, 9)])], 'Achievement unlocked.')
reg(C, 'streak', [f(250, e='angry', m='grin', al='flex', ar='flex', p=[('flame', 14, 0, i), ('count', 14 + 2, -7, 7)]) for i in range(4)], 'Seven-day streak.')
reg(C, 'tip_hint', [f(300, e='up', m='smile', ar='far', p=[('bulb', 14, -4)]), f(300, e='right', m='smile', ar='far', p=[('bulb', 14, -4), ('twinkle', 20, -3)])], 'Here is a tip.')
reg(C, 'tutorial_point', [f(250, e='right', ar='far', p=[('arrow_dn', 20, -8 + i % 2), pill('HERE', 'c', 'u', 12, -14)]) for i in range(4)], 'Pointing things out.')
reg(C, 'keyboard_shortcut', [f(250, e='down', m='small', p=[('bubble', 14, 4, 'CTRL', 'x', 'g', 'w'), ('bubble', 28, 4, 'K', 'x', 'g', 'w')]), f(150, e='star', m='open', p=[('bubble', 14, 5, 'CTRL', 'x', 'g', 'w'), ('bubble', 28, 5, 'K', 'x', 'g', 'w'), ('spark_s', 38, 3)]), f(300, e='happy', m='smile', p=[('bubble', 14, 4, 'CTRL', 'x', 'g', 'w'), ('bubble', 28, 4, 'K', 'x', 'g', 'w')])], 'Press the shortcut.')
reg(C, 'feedback_thanks', [f(300, e='happy', m='smile', p=[bub('THX', 8, -9)]), f(400, e='closed', m='smile', y=1, p=[bub('THX', 8, -9), ('heart', 14, -3)])], 'Thanks for the feedback.')
reg(C, 'first_commit', [f(250, e='right', ar='far', p=[lap('code', 1)]), f(300, e='star', m='grin', ar='up', p=[lap('ok', 0), bub('FIRST', 12, -9)]), f(400, e='star', m='grin', al='cheer', ar='cheer', y=-1, p=[lap('ok', 1), conf(2, 10)])], 'Your first commit.')
reg(C, 'screensaver', [f(300, x=i * 2 - 4 if i < 5 else (9 - i) * 2 - 4, y=(i % 3), e='closed' if i % 2 else 'happy', m='small', p=[txt('Z', 14, -3, 'v'), ('twinkle', -6, -2 + i % 2)]) for i in range(10)], 'Idle screensaver drifting around.')

C = 'ui_team'
reg(C, 'status_online', [f(400, e='happy', m='smile', p=[('dot_g', 13, -2), pill('ONLINE', 'G', 'u', 6, -9)]), f(400, e='open', m='smile', p=[('dot_g', 13, -2), pill('ONLINE', 'G', 'u', 6, -9)])], 'Presence: online.')
reg(C, 'status_busy', [f(400, e='angry', m='flat', ar='far', p=[('dot_r', 13, -2), pill('BUSY', 'r', 'w', 6, -9), lap('code', 0, 16, 6)]), f(400, e='angry', m='flat', ar='out', p=[('dot_r', 13, -2), pill('BUSY', 'r', 'w', 6, -9), lap('code', 2, 16, 6)])], 'Presence: busy.')
reg(C, 'status_away', [f(500, e='closed', m='small', p=[('moon', 13, -4), pill('AWAY', 'Y', 'u', 4, -10)]), f(500, e='closed', m='small', y=1, p=[('moon', 13, -4), pill('AWAY', 'Y', 'u', 4, -10), txt('Z', 14, 1, 'v')])], 'Presence: away.')
reg(C, 'comment_added', [f(250, e='right', m='small', p=[('pin', 14, 0)]), f(300, e='happy', m='smile', ar='up', p=[('pin', 14, 0), ('dots', 12, -10, 3)])], 'Left a comment.')
reg(C, 'reaction_thumbs', [f(250, e='happy', m='smile', ar='up'), f(300, e='happy', m='grin', ar='up', p=[('spark_s', 14, 0), ('twinkle', 16, -3)])], 'Thumbs-up reaction.')
reg(C, 'reaction_heart', [f(250, e='heart', m='smile', p=[('heart', 13, -2 - i * 2)]) for i in range(3)], 'Heart reaction.')
reg(C, 'reaction_party', [f(200, e='happy', m='grin', acc=['party'], al='cheer', ar='cheer', y=-(i % 2), p=[conf(i, 11)]) for i in range(5)], 'Party reaction.')
reg(C, 'reaction_laugh', [f(150, e='happy', m='grin', y=-(i % 2), p=[txt('LOL', 14, -2 - i % 2, 'Y')]) for i in range(5)], 'Laugh reaction.')
reg(C, 'seat_added', [f(250, e='open', fr=None, p=[('twinkle', 17, 3)]), f(250, e='happy', m='smile', fr=dict(e='open', m='small'), p=[('spark_s', 20, -1)]), f(400, e='happy', m='grin', al='upw', fr=dict(e='happy', m='grin', ar='upw'), p=[pill('SEAT +1', 'G', 'u', 8, -9)])], 'A new seat in the workspace.')
reg(C, 'teammate_typing', [f(300, e='right', m='small', ar='far', fr=dict(e='down', m='small', ar='far'), p=[lap('code', i, 14, 6)]) for i in range(5)], 'Teammate editing alongside you.', gap=26)
reg(C, 'queue_position', [f(280, e='right', m='small', p=[('envelope', 15 + i * 3, 6), ('envelope', 21 + i * 3, 6), ('envelope', 27 + i * 3, 6)][: 1 + (i % 3)]) for i in range(6)], 'Your message is in the queue.')
reg(C, 'master_session', [f(300, e='happy', m='smile', acc=['crown'], fr=dict(e='left', m='small'), p=[pill('HOST', 'Y', 'u', 6, -9)]), f(300, e='happy', m='smile', acc=['crown'], ar='far', fr=dict(e='left', m='small', al='far'), p=[pill('HOST', 'Y', 'u', 6, -9), ('envelope', 14, 4)])], 'One host session, others queue in.')
reg(C, 'multiplayer_cursors', [f(220, e=['left', 'right', 'up'][i % 3], m='smile', p=[('cursor', 14 + (i * 3) % 14, 1 + (i * 2) % 8, 'c'), ('cursor', 28 - (i * 4) % 14, 6 - (i * 3) % 6, 'p'), ('cursor', 16 + (i * 5) % 12, 11 - (i * 2) % 5, 'Y'), ('cursor', 30 - (i * 2) % 10, 0 + (i * 3) % 5, 'b')]) for i in range(8)], 'Four teammates, four cursors.')
