"""All Cento animations, defined as data. Props are placed relative to Cento's top-left corner
(0, 0); the sprite is 12x12, arms reach 3px out to each side, y < 0 is above the head.
For two-character scenes the friend sits `gap` columns to the right (default 16)."""
from cento_lib import f

ANIMS = []


def reg(cat, name, frames, desc='', gap=16, fpal='green'):
    ANIMS.append(dict(cat=cat, name=name, frames=frames, desc=desc, gap=gap, fpal=fpal))


LAP = 16


def lap(mode, t, dx=LAP, dy=6):
    return ('laptop', dx, dy, mode, t)


def bub(text, dx=8, dy=-9, tail='l'):
    return ('bubble', dx, dy, text, tail)


def txt(text, dx, dy, color='w'):
    return ('text', dx, dy, text, color)


def conf(t, seed=0):
    return ('confetti', -6, -12, t, seed, 24, 24, 24)


# ================================================================ BASICS
C = 'basics'
reg(C, 'idle_breathe', [f(450, y=0), f(450, y=1)], 'Calm breathing loop.')
reg(C, 'idle_blink', [f(900), f(110, e='closed'), f(600), f(110, e='closed'), f(110), f(110, e='closed'), f(900)], 'Slow blinks, one double blink.')
reg(C, 'look_around', [f(350, e='left'), f(350, e='up'), f(350, e='right'), f(350, e='down'), f(350, e='open')], 'Glances in every direction.')
reg(C, 'hop', [f(160, lg='a'), f(110, y=-2, lg='tuck', m='smile'), f(130, y=-4, lg='tuck', m='open'), f(110, y=-2, lg='tuck', m='smile'), f(160, lg='a', m='smile')], 'Single hop.')
reg(C, 'bounce', [f(120, y=0, m='smile', e='happy'), f(110, y=-3, lg='tuck', m='grin', e='happy'), f(120, y=0, m='smile', e='happy')], 'Continuous happy bounce.')
reg(C, 'wiggle', [f(110, x=-1, e='happy', m='smile'), f(110, x=1, e='happy', m='smile')] * 2, 'Excited side-to-side wiggle.')
reg(C, 'sway', [f(300, x=-1), f(300, x=0), f(300, x=1), f(300, x=0)], 'Slow idle sway.')
reg(C, 'walk_right', [f(130, x=2 * i, e='right') for i in range(8)], 'Walks to the right.')
reg(C, 'walk_left', [f(130, x=-2 * i, e='left') for i in range(8)], 'Walks to the left.')
reg(C, 'stretch', [f(300), f(400, al='high', ar='high', e='closed', m='open', y=-1), f(400, al='high', ar='high', e='closed', m='gasp', y=-1), f(300, al='out', ar='out', e='happy', m='smile')], 'Big morning stretch.')
reg(C, 'tap_foot', [f(110, e='right', m='frown', lg='a'), f(110, e='right', m='frown', lg='b')] * 3 + [f(300, e='left', m='frown', lg='a', p=[('sweat', 12, 3)])], 'Impatiently tapping.')
reg(C, 'whistle', [f(220, m='small', e='up', p=[('note', 13, -2)]), f(220, m='small', e='up', p=[('note_p', 14, -5)]), f(220, m='small', e='up', p=[('note', 13, -8)]), f(220, m='small', e='happy')], 'Whistling a tune.')
reg(C, 'backflip', [f(150), f(110, y=-3, lg='tuck', rot=1, m='open'), f(110, y=-5, lg='tuck', rot=2, m='open'), f(110, y=-3, lg='tuck', rot=3, m='open'), f(180, y=0, m='grin', e='happy')], 'Full flip.')
reg(C, 'shrug', [f(300), f(500, al='upw', ar='upw', m='flat', e='open'), f(500, al='upw', ar='upw', m='flat', e='closed'), f(300)], 'Who knows?')
reg(C, 'nod_yes', [f(160, y=0), f(160, y=1, e='closed'), f(160, y=0), f(160, y=1, e='closed'), f(300, y=0, m='smile')], 'Nodding yes.')
reg(C, 'shake_no', [f(140, x=-1, e='left', m='frown'), f(140, x=1, e='right', m='frown')] * 2 + [f(300, m='frown')], 'Shaking no.')
reg(C, 'wave', [f(200, al='upw', e='happy', m='smile'), f(200, al='up', e='happy', m='smile')] * 3, 'Friendly wave.')
reg(C, 'salute', [f(300), f(600, ar='up', e='open', m='flat', p=[]), f(300)], 'Roger that.')
reg(C, 'point_right', [f(250, ar='far', e='right'), f(250, ar='far', e='right', m='smile'), f(250, ar='out', e='right', m='smile')], 'Points over there.')
reg(C, 'tiptoe', [f(180, x=i, e='right', m='small', lg='tuck', y=-1 if i % 2 else 0) for i in range(6)], 'Sneaky tiptoeing.')

# ================================================================ CODING
C = 'coding'
reg(C, 'typing', [f(140, e='right', ar='far' if i % 2 else 'out', p=[lap('code', i)]) for i in range(6)], 'Typing away at the laptop.')
reg(C, 'typing_fast', [f(80, e='right', m='small', ar='far' if i % 2 else 'out', p=[lap('code', i), ('spark_s', 27, 3 + (i % 3))]) for i in range(8)], 'In the zone, fast typing.')
reg(C, 'coffee_coding', [f(160, e='right', ar='far' if i % 2 else 'out', p=[lap('code', i), ('cup', -9, 6), ('steam1' if i % 2 else 'steam2', -8, 2)]) for i in range(6)], 'Coffee-fuelled coding.')
reg(C, 'debugging', [f(220, e='right', ar='out', p=[lap('bug', i), ('magnifier', 16 + (i % 4) * 2, 1 + (i % 2))]) for i in range(8)], 'Hunting a bug on screen.')
reg(C, 'bug_squash', [
    f(220, e='right', p=[('bug', 18, 8)]),
    f(220, e='right', ar='up', p=[('bug', 19, 8), ('hammer', 11, 0)]),
    f(120, e='right', ar='up', p=[('bug', 20, 8), ('hammer', 11, -1)]),
    f(100, e='right', ar='far', m='grin', p=[('bug', 20, 9), ('hammer_h', 15, 8), ('spark_s', 19, 5)]),
    f(300, e='happy', m='smile', ar='far', p=[('xmark_s', 20, 9), ('hammer_h', 15, 8)]),
], 'Whack the bug.')
reg(C, 'reading_code', [f(260, e=e, acc=['glasses'], p=[lap('code', i)]) for i, e in enumerate(['right', 'down', 'right', 'down', 'right', 'up'])], 'Reading code with nerd glasses.')
reg(C, 'code_review', [
    f(300, e='right', acc=['glasses'], p=[lap('code', 0), ('check', 28, 2)]),
    f(300, e='down', acc=['glasses'], p=[lap('code', 2), ('xmark_s', 28, 3)]),
    f(300, e='right', acc=['glasses'], p=[lap('code', 4), ('check', 28, 2)]),
    f(400, e='happy', m='smile', acc=['glasses'], ar='up', p=[lap('ok', 0), bub('LGTM', 8, -9)]),
], 'Careful review, then approval.')
reg(C, 'refactor', [f(180, e='right', ar='far' if i % 2 else 'out', p=[lap('code', i * 2), ('twinkle', 17 + (i * 3) % 8, 3), ('spark_s', 26 - (i * 2) % 6, 4)]) for i in range(6)], 'Making the code shine.')
reg(C, 'compiling', [f(200, e='right', m='small', p=[lap('load', i), ('spinner', 20, -1, i)]) for i in range(10)], 'Waiting on the build.')
reg(C, 'tests_passing', [
    f(220, e='right', p=[lap('ok', 0)]),
    f(220, e='happy', m='smile', al='cheer', ar='cheer', y=-2, lg='tuck', p=[lap('ok', 1), ('check', 17, 0)]),
    f(220, e='happy', m='grin', al='cheer', ar='cheer', y=0, p=[lap('ok', 0), ('check', 17, 0), ('check', 23, -2)]),
    f(220, e='happy', m='grin', al='cheer', ar='cheer', y=-2, lg='tuck', p=[lap('ok', 1), ('check', 17, 0), ('check', 23, -2), ('spark_s', 12, -3)]),
], 'All green.')
reg(C, 'tests_failing', [
    f(250, e='right', m='frown', p=[lap('err', 0)]),
    f(250, e='sad', m='frown', p=[lap('err', 1), ('xmark_s', 18, 1)]),
    f(250, e='sad', m='zig', acc=['sweat'], p=[lap('err', 0), ('xmark_s', 18, 1), ('xmark_s', 24, -1)]),
], 'Red tests, sinking feeling.')
reg(C, 'git_commit', [
    f(200, e='right', ar='far', p=[lap('code', 1)]),
    f(200, e='right', ar='out', p=[lap('code', 2)]),
    f(350, e='happy', m='smile', p=[lap('ok', 0), bub('GIT', 16, -6, 'l')]),
    f(350, e='happy', m='grin', ar='up', p=[lap('ok', 1), bub('GIT', 16, -6, 'l'), ('check', 17, 0)]),
], 'Committed.')
reg(C, 'git_push', [f(200, e='right', m='small', p=[lap('ok', 0), ('arrow_up', 18, 0 - i * 2)]) for i in range(7)] + [f(300, e='happy', m='grin', ar='up', p=[lap('ok', 1), ('twinkle', 19, -14)])], 'Pushing upstream.')
reg(C, 'git_merge', [f(300, e='right', p=[('branch', 16, 1, i)]) for i in range(4)] + [f(400, e='happy', m='grin', ar='up', p=[('branch', 16, 1, 3), ('spark_s', 20, -2)])], 'Branches merge cleanly.')
reg(C, 'merge_conflict', [
    f(250, e='right', p=[('branch', 16, 1, 2)]),
    f(250, e='ring', m='gasp', p=[('branch', 16, 1, 3), ('xmark', 22, 0)]),
    f(250, e='ring', m='zig', acc=['sweat'], p=[('branch', 16, 1, 3), ('xmark', 22, 0), txt('???', 16, -6, 'r')]),
    f(250, e='x', m='frown', p=[('branch', 16, 1, 3), ('xmark', 22, 0)]),
], 'Merge conflict panic.')
reg(C, 'rubber_duck', [
    f(200, e='right', m='open', p=[('duck', 15, 6)]),
    f(200, e='right', m='flat', p=[('duck', 15, 6)]),
    f(200, e='right', m='open', p=[('duck', 15, 6)]),
    f(200, e='right', m='flat', p=[('duck', 15, 6)]),
    f(400, e='star', m='grin', ar='up', p=[('duck', 15, 6), ('bulb', 9, -8)]),
], 'Explaining the bug to the duck, then the lightbulb.')
reg(C, 'stack_overflow', [
    f(300, e='right', m='frown', p=[lap('err', 0)]),
    f(300, e='up', m='small', p=[lap('load', 2), txt('?', 14, -4, 'Y')]),
    f(200, e='right', ar='far', p=[lap('code', 1), txt('C', 14, -4, 'c')]),
    f(200, e='right', ar='out', p=[lap('code', 3), txt('V', 14, -4, 'p')]),
    f(400, e='happy', m='smile', p=[lap('ok', 0)]),
], 'Search, copy, paste, ship.')
reg(C, 'rage_typing', [f(70, e='angry', m='zig', x=(i % 2) * 2 - 1, ar='far' if i % 2 else 'out', p=[lap('err', i), ('xmark_s', 12, -2 - i % 2), ('puff', -4, 0)]) for i in range(8)], 'Smashing the keyboard.')
reg(C, 'copy_paste', [
    f(220, e='right', ar='far', p=[lap('code', 1), txt('C', 15, -5, 'c')]),
    f(220, e='right', ar='out', p=[lap('code', 2), txt('C', 15, -5, 'c'), txt('V', 20, -5, 'p')]),
    f(300, e='happy', m='smile', p=[lap('code', 4), txt('V', 20, -5, 'p')]),
], 'Ctrl-C, Ctrl-V.')
reg(C, 'deploy', [f(180, e='up', m='open', ar='up', p=[('rocket', 17, 4 - i * 3), ('flame', 18, 10 - i * 3, i)]) for i in range(8)], 'Liftoff.')
reg(C, 'hotfix', [
    f(150, e='ring', m='gasp', al='high', ar='high', y=-1, p=[('flame', 16, 7, 0), lap('err', 0, 19)]),
    f(150, e='ring', m='gasp', al='high', ar='high', y=0, p=[('flame', 16, 7, 1), lap('err', 1, 19)]),
    f(250, e='angry', m='flat', ar='far', p=[('flame', 16, 7, 0), lap('code', 3, 19)]),
    f(250, e='right', m='small', ar='out', p=[lap('code', 5, 19), ('puff', 16, 7)]),
    f(400, e='happy', m='grin', ar='up', p=[lap('ok', 0, 19), ('check', 20, 0)]),
], 'Prod is on fire, fix it, breathe.')
reg(C, 'lgtm', [f(250, e='happy', m='smile'), f(500, e='happy', m='grin', ar='up', p=[bub('LGTM', 8, -9), ('spark_s', 14, 2)]), f(300, e='happy', m='smile', ar='up', p=[bub('LGTM', 8, -9)])], 'Looks good to me.')
reg(C, 'ship_it', [f(200, e='angry', m='grin', ar='far', p=[('gift', 16 + i * 2, 6)]) for i in range(5)] + [f(400, e='happy', m='grin', ar='up', p=[bub('SHIP', 8, -9), ('gift', 26, 6)])], 'Push the package out the door.')
reg(C, 'dark_mode', [f(500, e='right', p=[lap('code', 0)]), f(120, e='ring', m='open', p=[lap('code', 0)]), f(500, e='right', m='smile', acc=['sunglasses'], p=[lap('code', 1)])], 'Puts on shades for dark mode.')
reg(C, 'infinite_loop', [f(200, e=['left', 'up', 'right', 'down'][i % 4], m='flat', p=[('spinner', 16, 2, i), lap('load', i, 22)]) for i in range(8)], 'Eyes going round and round.')

# ================================================================ AGENT STATES
C = 'agent'
reg(C, 'thinking', [f(300, e='up', m='small', p=[('dots', 8, -10, n)]) for n in (1, 2, 3, 3)], 'Thinking... dots filling in.')
reg(C, 'thinking_hard', [f(240, e='squint', m='zig', acc=['sweat'], p=[('bulb', 9, -9)] if i % 2 else []) for i in range(6)], 'Deep thought, bulb flickering.')
reg(C, 'searching', [f(200, e='left' if i % 2 == 0 else 'right', ar='far', p=[('magnifier', 14 + [0, 3, 6, 3][i % 4], 4)]) for i in range(8)], 'Looking for it.')
reg(C, 'reading_docs', [f(350, e='down', m='small', p=[('book', 2, 9)]), f(350, e='down', m='small', ar='out', p=[('book', 2, 9), ('twinkle', 12, 8)]), f(350, e='right', m='small', p=[('book', 2, 9)])], 'Reading the docs.')
reg(C, 'writing_plan', [f(300, e='right', ar='far', p=[('list', 16, 2), ('pencil', 12, 6)]), f(300, e='right', ar='out', p=[('list', 16, 2), ('pencil', 13, 7), ('check', 17, 3)]), f(300, e='down', ar='far', p=[('list', 16, 2), ('pencil', 12, 6), ('check', 17, 3), ('check', 17, 5)]), f(400, e='happy', m='smile', p=[('list', 16, 2), ('check', 17, 3), ('check', 17, 5), ('check', 17, 7)])], 'Drafting a plan.')
reg(C, 'planning', [f(400, e='up', m='small', p=[('thought', 8, -12), ('twinkle', 11, -10)]), f(400, e='right', m='small', p=[('thought', 8, -12), ('gear', 10, -11)]), f(400, e='left', m='small', p=[('thought', 8, -12), ('check', 10, -11)])], 'Mapping it out.')
reg(C, 'running_command', [f(180, e='right', ar='far' if i % 2 else 'out', p=[lap('term', i)]) for i in range(6)], 'Running a shell command.')
reg(C, 'installing', [f(200, e='right', m='small', p=[('progress', 14, -2, 14, i / 9), ('gift', 18, 3)]) for i in range(10)], 'Installing dependencies.')
reg(C, 'downloading', [f(200, e='down', m='small', p=[('arrow_dn', 8, -10 + i % 3), ('progress', 14, 3, 14, i / 9)]) for i in range(10)], 'Downloading.')
reg(C, 'uploading', [f(200, e='up', m='small', p=[('arrow_up', 8, -10 - i % 3), ('progress', 14, 3, 14, i / 9, 'c')]) for i in range(10)], 'Uploading.')
reg(C, 'waiting', [f(500, e='right', m='flat', p=[('hourglass', 15, 4, i)]) for i in range(4)] + [f(250, e='left', m='frown', lg='a', p=[('hourglass', 15, 4, 1)]), f(250, e='left', m='frown', lg='b', p=[('hourglass', 15, 4, 1)])], 'Hourglass patience.')
reg(C, 'loading', [f(120, e='up', m='small', p=[('spinner', 4, -8, i)]) for i in range(12)], 'Spinner above the head.')
reg(C, 'syncing', [f(150, e='closed', m='smile', p=[('cloud', 3, -10), ('spinner', 4, -4, i)]) for i in range(12)], 'Syncing with the cloud.')
reg(C, 'queued', [f(250, e='left', p=[('envelope', -14 + (i % 5) * 3, 6), ('envelope', -18 + (i % 5) * 3, 6)]) for i in range(5)], 'Messages queueing up.')
reg(C, 'tool_approve', [f(300, e='open'), f(500, e='happy', m='smile', ar='up', p=[bub('OK', 8, -9), ('check', 14, 2)]), f(400, e='happy', m='grin', ar='up', p=[bub('OK', 8, -9), ('check', 14, 2), ('twinkle', 3, -3)])], 'Tool call approved.')
reg(C, 'tool_deny', [f(250, e='open'), f(250, e='angry', m='flat', al='out', ar='out', x=-1, p=[bub('NO', 8, -9), ('xmark', 14, 1)]), f(250, e='angry', m='flat', al='out', ar='out', x=1, p=[bub('NO', 8, -9), ('xmark', 14, 1)]), f(250, e='angry', m='flat', al='out', ar='out', x=0, p=[bub('NO', 8, -9), ('xmark', 14, 1)])], 'Tool call denied.')
reg(C, 'asking_question', [f(300, e='up', m='small', x=0, p=[txt('?', 14, -4, 'Y')]), f(300, e='up', m='small', x=1, p=[txt('?', 14, -4, 'Y'), txt('?', 4, -8, 'Y')]), f(300, e='right', m='small', x=0, p=[txt('?', 14, -4, 'Y')])], 'Needs clarification.')
reg(C, 'sub_agent_spawn', [f(200, e='up', m='open', ar='up'), f(200, e='star', m='grin', ar='up', p=[('spark_s', 14, 0), ('twinkle', -4, 2)]), f(200, e='happy', m='grin', ar='up', p=[('spark', 15, 2), ('spark_s', -5, 4), ('twinkle', 12, -2)])], 'Spawning a helper.')
reg(C, 'context_full', [f(300, e='ring', m='open', acc=['sweat'], p=[('cup', -9, 6)]), f(300, e='ring', m='gasp', acc=['sweat'], p=[('cup', -9, 6), ('drop', -4, 8), ('drop', -8, 9)]), f(300, e='x', m='zig', p=[('cup', -9, 6), ('drop', -4, 9), ('drop', -8, 10)])], 'Context window overflowing.')
reg(C, 'compacting', [f(200, e='closed', m='flat', y=0), f(200, e='squint', m='flat', y=1, al='out', ar='out'), f(200, e='squint', m='small', y=2, al='side', ar='side', p=[('puff', 14, 8), ('puff', -5, 8)]), f(300, e='happy', m='smile', y=0)], 'Squishing context down.')
reg(C, 'auto_mode', [f(160, e='right', ar='far' if i % 2 else 'out', p=[lap('term', i), ('spinner', 20, -2, i * 2)]) for i in range(8)], 'Working autonomously.')

# ================================================================ REST
C = 'rest'
BED = [('hline', -2, 12, 22, 'v'), ('hline', -2, 13, 22, 'q'), ('hline', -2, 14, 22, 'N'), ('pillow', 12, 10)]
BED_FG = [('hline', -2, 12, 22, 'v')]
def zz(i, dx=14):
    return [txt('Z', dx + (i % 3), -2 - (i % 4) * 2, 'v'), txt('Z', dx + 3 + (i % 3), -7 - (i % 4), 'w')][: 1 + (i % 2)]
reg(C, 'sleeping', [f(500, y=-1, rot=1, e='closed', m='small', lg='tuck', bg=BED, p=[txt('Z', 14, -5 - i * 2, 'v')] + ([txt('Z', 17, -10 - i, 'w')] if i > 0 else [])) for i in range(3)] + [f(500, y=-1, rot=1, e='closed', m='small', lg='tuck', bg=BED)], 'Tucked in, snoozing.')
reg(C, 'deep_sleep', [f(500, y=-1, rot=1, e='closed', m='open', lg='tuck', bg=BED, p=[txt('Z', 14, -4, 'v'), txt('Z', 17, -9, 'w'), ('dot_w', 12, 3)]), f(500, y=-1, rot=1, e='closed', m='open', lg='tuck', bg=BED, p=[txt('Z', 15, -5, 'v'), txt('Z', 18, -10, 'w')])], 'Out cold.')
reg(C, 'dozing_sitting', [f(450, e='closed', m='small', y=0, lg='tuck', p=[txt('Z', 14, -3, 'v')]), f(450, e='closed', m='small', y=1, lg='tuck', p=[txt('Z', 15, -5, 'v'), txt('Z', 18, -9, 'w')]), f(300, e='squint', m='flat', y=0, lg='tuck')], 'Nodding off.')
reg(C, 'nap_at_desk', [f(500, e='closed', m='small', y=1, x=2, al='out', ar='far', p=[lap('blank', 0), txt('Z', 14, -2, 'v')]), f(500, e='closed', m='small', y=2, x=2, al='out', ar='far', p=[lap('blank', 0), txt('Z', 15, -4, 'v'), txt('Z', 18, -8, 'w')])], 'Face-down on the keyboard.')
reg(C, 'yawn', [f(300, e='squint', m='flat'), f(500, e='closed', m='gasp', ar='up', y=-1), f(500, e='closed', m='gasp', ar='up', y=-1), f(300, e='squint', m='small', y=0)], 'Big yawn.')
reg(C, 'wake_up', [f(400, y=-1, rot=1, e='closed', m='small', lg='tuck', bg=BED), f(150, y=-1, rot=1, e='squint', m='flat', lg='tuck', bg=BED), f(250, y=-1, rot=1, e='open', m='flat', lg='tuck', bg=BED, p=[('alarm', 5, -8)]), f(250, y=-1, rot=1, e='ring', m='open', lg='tuck', bg=BED, p=[('alarm', 5, -8), txt('!', 15, -4, 'r')])], 'Alarm clock rings.')
reg(C, 'dreaming', [f(550, y=-1, rot=1, e='closed', m='smile', lg='tuck', bg=BED, p=[('thought', 12, -14), ('heart_s', 14, -13)]), f(550, y=-1, rot=1, e='closed', m='smile', lg='tuck', bg=BED, p=[('thought', 12, -14), ('spark_s', 14, -13)]), f(550, y=-1, rot=1, e='closed', m='grin', lg='tuck', bg=BED, p=[('thought', 12, -14), ('ball', 12, -13)])], 'Dreaming of nice things.')
reg(C, 'coffee_sip', [f(300, e='open', ar='up', p=[('cup', 10, 6)]), f(300, e='closed', m='small', ar='up', p=[('cup', 10, 3)]), f(400, e='happy', m='smile', ar='up', p=[('cup', 10, 3), ('steam1', 11, 0)]), f(300, e='open', m='smile', ar='up', p=[('cup', 10, 6)])], 'A sip of coffee.')
reg(C, 'coffee_refuel', [f(280, e='squint', m='flat', p=[('cup', -9, 6)] * 1), f(280, e='open', m='small', p=[('cup', -9, 6), ('cup', -9, 2)]), f(280, e='star', m='grin', ar='cheer', p=[('cup', -9, 6), ('cup', -9, 2), ('cup', -9, -2)]), f(280, e='star', m='grin', ar='cheer', x=1, p=[('cup', -9, 6), ('cup', -9, 2), ('cup', -9, -2), ('twinkle', -4, -4)])], 'Caffeine stack.')
reg(C, 'insomnia', [f(500, y=-1, rot=1, e='open', m='flat', lg='tuck', bg=BED, p=[('moon', 12, -9), txt('1', 20, -4, 'w')]), f(500, y=-1, rot=1, e='left', m='frown', lg='tuck', bg=BED, p=[('moon', 12, -9), txt('2', 20, -4, 'w')]), f(500, y=-1, rot=1, e='up', m='frown', lg='tuck', bg=BED, p=[('moon', 12, -9), txt('3', 20, -4, 'w')])], 'Counting numbers, still awake.')
reg(C, 'meditate', [f(450, y=-1 - (i % 2), lg='tuck', e='closed', m='small', al='side', ar='side', p=[('twinkle', -5, 2 - (i % 2) * 2), ('twinkle', 14, 1 + (i % 2) * 2)]) for i in range(4)], 'Floating zen.')
reg(C, 'lullaby', [f(450, y=-1, rot=1, e='closed', m='smile', lg='tuck', bg=BED, p=[('note', 14, -4 - (i % 3) * 3), ('note_p', 18, -7 - (i % 2) * 3)]) for i in range(4)], 'Soft music, sweet sleep.')
reg(C, 'sleepwalk', [f(250, x=i, e='closed', m='small', al='far', ar='far', lg='a' if i % 2 else 'b', p=[txt('Z', 14, -3 - (i % 3), 'v')]) for i in range(6)], 'Walks in their sleep.')

# ================================================================ EMOTIONS
C = 'emotions'
reg(C, 'happy', [f(200, e='happy', m='smile', y=0), f(200, e='happy', m='grin', y=-1), f(200, e='happy', m='smile', y=0), f(200, e='happy', m='grin', y=-1)], 'Simply happy.')
reg(C, 'excited', [f(110, e='star', m='grin', al='cheer', ar='cheer', y=-2, lg='tuck', p=[('spark_s', -5, -2), ('spark_s', 14, -3)]), f(110, e='star', m='grin', al='cheer', ar='cheer', y=0, p=[('spark_s', -4, -4), ('spark_s', 13, -1)])] * 3, 'Cannot sit still.')
reg(C, 'proud', [f(400, e='happy', m='smile'), f(600, e='happy', m='grin', al='flex', ar='flex', y=-1, p=[('twinkle', -4, 3), ('twinkle', 13, 4)]), f(400, e='happy', m='grin', al='flex', ar='flex', y=-1, p=[('spark_s', -5, 1), ('spark_s', 14, 2)])], 'Chest out.')
reg(C, 'love', [f(350, e='heart', m='smile', p=[('heart', 13 - i % 2, -2 - i * 3), ('heart_s', -3, -6 - i * 2)]) for i in range(4)], 'Heart eyes, floating hearts.')
reg(C, 'shy', [f(350, e='closed', m='small', al='cover', ar='cover', x=0, acc=['blush']), f(350, e='closed', m='small', al='cover', ar='cover', x=1, acc=['blush']), f(350, e='right', m='small', acc=['blush'], x=1)], 'Hiding the face.')
reg(C, 'sad', [f(500, e='sad', m='frown', y=1, lg='a'), f(500, e='sad', m='frown', y=1, lg='b')], 'Feeling down.')
reg(C, 'crying', [f(180, e='sad', m='frown', y=1, p=[('tear', 3, 8 + i), ('tear', 8, 9 + i)]) for i in range(4)] + [f(180, e='sad', m='frown', y=1, p=[('drop', 3, 12), ('drop', 8, 12)])], 'Tears streaming.')
reg(C, 'angry', [f(250, e='angry', m='frown', p=[('xmark_s', 11, 0)]), f(250, e='angry', m='frown', x=1, p=[('xmark_s', 11, -1), ('puff', 13, 2)]), f(250, e='angry', m='frown', x=-1, p=[('xmark_s', 11, 0), ('puff', -4, 2)])], 'Fuming.')
reg(C, 'rage', [f(70, e='angry', m='gasp', x=(i % 2) * 2 - 1, al='high', ar='high', p=[('flame', 3 + (i % 2), -6, i), txt('!!', -6, -2, 'r')]) for i in range(8)], 'Full rage.')
reg(C, 'scared', [f(80, e='ring', m='gasp', x=(i % 2) * 2 - 1, acc=['sweat'], p=[txt('!', 14, -3, 'r')]) for i in range(8)], 'Trembling with fear.')
reg(C, 'surprised', [f(250), f(80, e='ring', m='open', y=-3, lg='tuck', p=[txt('!', 14, -4, 'r')]), f(500, e='ring', m='open', y=-1, lg='tuck', p=[txt('!', 14, -4, 'r')]), f(300, e='ring', m='open', y=0)], 'Whoa!')
reg(C, 'confused', [f(300, e='left', m='zig', x=-1, p=[txt('?', 14, -4, 'Y')]), f(300, e='right', m='zig', x=1, p=[txt('?', 14, -4, 'Y'), txt('?', -4, -2, 'Y')]), f(300, e=('up', 'right'), m='zig', p=[txt('?', 14, -4, 'Y'), txt('?', -4, -2, 'Y'), txt('?', 5, -8, 'Y')])], 'Wait, what?')
reg(C, 'embarrassed', [f(350, e='squint', m='zig', acc=['blush', 'sweat']), f(350, e='closed', m='small', acc=['blush', 'sweat'], al='cover'), f(350, e='right', m='zig', acc=['blush', 'sweat'], x=1)], 'Red-faced.')
reg(C, 'bored', [f(450, e='squint', m='flat'), f(450, e='left', m='flat', x=-1), f(450, e='right', m='flat', x=1), f(450, e='up', m='small', y=1)], 'So bored.')
reg(C, 'sassy', [f(250, e='up', m='flat', al='dn', ar='dn'), f(250, e='right', m='flat', al='dn', ar='dn'), f(250, e='down', m='flat', al='dn', ar='dn'), f(250, e='left', m='flat', al='dn', ar='dn'), f(400, e='squint', m='smile', al='dn', ar='dn')], 'Eye roll with hands on hips.')
reg(C, 'smug', [f(500, e='squint', m='grin'), f(500, e='squint', m='grin', al='flex', ar='flex', p=[('twinkle', -4, 2)]), f(500, e='squint', m='grin', p=[('twinkle', 13, 3)])], 'Knows they are right.')
reg(C, 'worried', [f(300, e='sad', m='zig', acc=['sweat']), f(300, e='sad', m='zig', x=1, acc=['sweat']), f(300, e='sad', m='zig', x=-1, acc=['sweat'])], 'Biting nails.')
reg(C, 'nervous', [f(90, e=('left', 'left') if i % 2 else ('right', 'right'), m='zig', x=(i % 2) * 2 - 1, acc=['sweat']) for i in range(8)], 'Jittery.')
reg(C, 'tired', [f(500, e='squint', m='frown', y=1, lg='tuck'), f(500, e='closed', m='frown', y=2, lg='tuck', p=[txt('Z', 14, -2, 'v')]), f(500, e='squint', m='frown', y=1, lg='tuck')], 'Running on fumes.')
reg(C, 'sick', [f(350, e='dz1', m='zig', acc=['green']), f(350, e='dz2', m='frown', acc=['green'], x=1), f(350, e='closed', m='gasp', acc=['green'], p=[('drop', 5, 10)])], 'Feeling green.')
reg(C, 'dizzy', [f(150, e='dz1' if i % 2 else 'dz2', m='open', x=[-1, 0, 1, 0][i % 4], p=[('twinkle', 1 + [0, 4, 8, 4][i % 4], -3 + [0, -1, 0, 1][i % 4])]) for i in range(8)], 'Everything is spinning.')
reg(C, 'laughing', [f(120, e='happy', m='grin', y=-(i % 2), p=[txt('HA', 14, -2 - (i % 2), 'Y')]) for i in range(8)], 'Cracking up.')
reg(C, 'giggle', [f(150, e='happy', m='smile', x=(i % 2), p=[txt('HE', 14, -1, 'p')]) for i in range(6)], 'Quiet giggling.')
reg(C, 'cool', [f(400, acc=['sunglasses'], m='smile'), f(300, acc=['sunglasses'], m='smile', al='flex', ar='flex', p=[('twinkle', 3, 5)]), f(300, acc=['sunglasses'], m='grin', al='flex', ar='flex', p=[('spark_s', 3, 5)])], 'Too cool.')
reg(C, 'lonely', [f(500, e='sad', m='frown', y=1, p=[('cloud_d', 2, -6), ('rain', 1, -3, i, 8, 5, 4)]) for i in range(3)], 'Own little rain cloud.')
reg(C, 'grateful', [f(300, e='happy', m='smile', p=[('heart', 13, -3)]), f(400, e='closed', m='smile', y=1, p=[('heart', 13, -4)]), f(300, e='happy', m='grin', p=[('heart', 13, -5), ('twinkle', -3, 2)])], 'Thank you.')
reg(C, 'mischievous', [f(300, e='angry', m='grin'), f(300, e='angry', m='tongue', x=1), f(300, e='angry', m='grin', x=-1)], 'Up to something.')
reg(C, 'determined', [f(300, e='angry', m='flat', al='flex', ar='flex'), f(300, e='angry', m='flat', al='flex', ar='flex', y=-1, p=[('flame', -6, 6, 0), ('flame', 13, 6, 1)])], 'Locked in.')
reg(C, 'hungry', [f(350, e='dot', m='open', p=[('pizza', 14, -2)]), f(350, e='right', m='open', y=1, p=[('pizza', 14, -2)]), f(350, e='right', m='gasp', p=[('pizza', 14, -2)])], 'Stomach rumbling at pizza.')

# ================================================================ ERRORS
C = 'errors'
reg(C, 'error', [f(120, e='x', m='frown', tip='R', x=(i % 2) * 2 - 1, p=[txt('!', 14, -3, 'r')]) for i in range(6)] + [f(400, e='x', m='frown', tip='R', p=[txt('!', 14, -3, 'r')])], 'Hard error.')
reg(C, 'crash', [f(150, e='ring', m='gasp', tip='R'), f(100, e='x', m='gasp', tip='R', p=[('burst', 0, 0, 0, 'Y', 6), ('burst', 6, 5, 0, 'r', 6)]), f(100, e='x', m='gasp', tip='R', p=[('burst', -1, -1, 2, 'O', 6), ('burst', 5, 4, 2, 'r', 6)]), f(100, e='x', m='gasp', tip='R', p=[('burst', -2, -2, 4, 'O', 6), ('burst', 4, 3, 4, 'r', 6)]), f(500, e='x', m='frown', tip='R', y=1, p=[('puff', 14, 0), ('puff', -5, 1)])], 'Boom.')
reg(C, 'panic', [f(90, e='ring', m='gasp', al='high', ar='high', y=-(i % 2), x=(i % 2) * 2 - 1, acc=['sweat'], p=[txt('!!', -6, -2, 'r')]) for i in range(8)], 'Arms in the air.')
reg(C, 'glitch', [f(90, e='x', m='zig', tip='R', gl=[(3, 2), (4, 2)]), f(60, e='open', m='flat', gl=[(7, -3), (8, -3), (9, -3)]), f(90, e='x', m='zig', tip='R', gl=[(5, 4), (11, -2)]), f(120, e='open', m='flat'), f(60, e='dot', m='zig', tip='R', gl=[(2, -2), (6, 3), (9, 2)]), f(300, e='open', m='flat')], 'Signal glitching.')
reg(C, 'on_fire', [f(120, e='ring', m='gasp', al='high', ar='high', y=-(i % 2), acc=['sweat'], p=[('flame', -5, 5, i), ('flame', 12, 5, i + 1), ('flame', 3, -6, i)]) for i in range(6)], 'Everything is fine.')
reg(C, 'facepalm', [f(350, e='open', m='flat'), f(550, e='closed', m='frown', al='cover', ar='down', y=1), f(550, e='closed', m='frown', al='cover', ar='down', y=1, x=1, acc=['sweat'])], 'Facepalm.')
reg(C, 'shrug_error', [f(300, e='open', m='flat', p=[txt('?', 14, -4, 'Y')]), f(500, e='open', m='flat', al='upw', ar='upw', p=[txt('?', 14, -4, 'Y'), txt('?', -4, -4, 'Y')]), f(500, e='closed', m='flat', al='upw', ar='upw', p=[txt('?', 14, -4, 'Y'), txt('?', -4, -4, 'Y')])], 'No idea what happened.')
reg(C, 'oops', [f(250, e='ring', m='open'), f(500, e='squint', m='zig', acc=['sweat'], p=[bub('OOPS', 8, -9)]), f(400, e='squint', m='zig', acc=['sweat', 'blush'], x=1, p=[bub('OOPS', 8, -9)])], 'Oops.')
reg(C, 'not_found_404', [f(250, e='left', m='zig', p=[txt('404', 0, -8, 'r'), ('magnifier', -8, 4)]), f(250, e='right', m='zig', p=[txt('404', 0, -8, 'r'), ('magnifier', 14, 4)]), f(250, e='up', m='zig', p=[txt('404', 0, -8, 'r'), ('magnifier', 6, -14)])], 'Page not found.')
reg(C, 'segfault', [f(110, e='x', m='gasp', tip='R', x=(i % 2) * 2 - 1, p=[txt('SEGV', -2, -8, 'r'), ('skull', 14, 0)]) for i in range(6)], 'Segmentation fault.')
reg(C, 'out_of_memory', [f(250, e='ring', m='gasp', acc=['sweat'], p=[txt('OOM', 0, -8, 'r'), ('cup', -9, 6), ('drop', -4, 9)]), f(250, e='x', m='zig', p=[txt('OOM', 0, -8, 'r'), ('cup', -9, 6), ('drop', -4, 9), ('drop', -7, 10)])], 'Out of memory.')
reg(C, 'timeout', [f(450, e='right', m='flat', p=[('hourglass', 15, 3, i), txt('...', 16, -3, 'w')]) for i in range(3)] + [f(300, e='x', m='frown', tip='R', p=[('hourglass', 15, 3, 1), txt('!', 20, -3, 'r')])], 'Request timed out.')
reg(C, 'permission_denied', [f(300, e='right', ar='far', p=[('lock', 16, 4)]), f(250, e='angry', m='frown', ar='far', p=[('lock', 16, 4), ('xmark', 22, 1)]), f(250, e='sad', m='frown', ar='down', p=[('lock', 16, 4), ('xmark', 22, 1)])], 'Locked out.')
reg(C, 'network_down', [f(350, e='up', m='flat', p=[('wifi', 4, -10)]), f(350, e='up', m='frown', p=[('wifi', 4, -10), ('xmark_s', 10, -9)]), f(350, e='sad', m='frown', p=[('wifi', 4, -10), ('xmark_s', 10, -9)])], 'No connection.')
reg(C, 'rate_limited', [f(300, e='ring', m='open', p=[('stopsign', 14, 0), txt('429', 12, -7, 'r')]), f(300, e='squint', m='flat', al='out', p=[('stopsign', 14, 0), txt('429', 12, -7, 'r')])], 'Slow down.')
reg(C, 'blue_screen', [f(300, e='x', m='frown', tip='R', bg=[('hline', -6, -4, 28, 'b')] + [('hline', -6, -3 + i, 28, 'b') for i in range(0, 18)], p=[txt(':(', 14, -2, 'w')]) for _ in range(2)], 'The classic.')

# ================================================================ SUCCESS
C = 'success'
reg(C, 'celebrate', [f(150, e='happy', m='grin', al='cheer', ar='cheer', y=-2 * (i % 2), lg='tuck' if i % 2 else 'a', p=[conf(i, 1)]) for i in range(8)], 'Hooray, confetti.')
reg(C, 'confetti_pop', [f(110, e='ring', m='open', p=[conf(i, 2)]) if i == 0 else f(110, e='happy', m='grin', ar='up', p=[conf(i, 2)]) for i in range(8)], 'Confetti burst.')
reg(C, 'trophy', [f(300, e='star', m='grin', al='up', ar='up', p=[('trophy', 2, -10 + i % 2), ('twinkle', -4, -8), ('twinkle', 14, -6)]) for i in range(4)], 'Holds up the trophy.')
reg(C, 'victory_dance', [f(150, x=[-1, 0, 1, 0][i % 4], e='happy', m='grin', al='cheer' if i % 2 else 'down', ar='down' if i % 2 else 'cheer', y=-(i % 2), p=[('note', 14, -3), ('note_p', -5, -5)] if i % 2 else []) for i in range(8)], 'Victory shimmy.')
reg(C, 'party', [f(250, e='happy', m='smile', acc=['party'], ar='up', p=[('balloon', 14, -2 - (i % 2)), ('gift', -9, 6), conf(i, 3)]) for i in range(6)], 'Party time.')
reg(C, 'fireworks', [f(220, e='up', m='open', p=[('burst', 9, -16, i, 'Y', 6), ('burst', -4, -12, max(0, i - 2), 'p', 6), ('burst', 18, -9, max(0, i - 1), 'c', 6)]) for i in range(7)], 'Fireworks show.')
reg(C, 'level_up', [f(180, e='star', m='grin', al='cheer', ar='cheer', y=-(i % 2) * 2, lg='tuck' if i % 2 else 'a', p=[txt('LV UP', 0, -9 - i, 'Y'), ('spark_s', -4, 1 - i), ('spark_s', 13, 3 - i)]) for i in range(6)], 'Level up.')
reg(C, 'thumbs_up', [f(300, e='happy', m='smile', ar='up'), f(300, e='happy', m='grin', ar='up', p=[('spark_s', 14, 1)]), f(300, e='happy', m='smile', ar='up', p=[('twinkle', 15, 0)])], 'Thumbs up.')
reg(C, 'mic_drop', [f(250, e='happy', m='smile', acc=['sunglasses'], ar='far', p=[('mic', 16, 5)]), f(200, e='squint', m='grin', acc=['sunglasses'], ar='far', p=[('mic', 16, 7)]), f(150, e='squint', m='grin', acc=['sunglasses'], ar='out', p=[('mic', 16, 11)]), f(500, e='squint', m='grin', acc=['sunglasses'], ar='out', p=[('mic', 16, 11), ('spark_s', 14, 8), txt('!', 20, 4, 'Y')])], 'Mic drop.')
reg(C, 'gg', [f(300, e='happy', m='smile', ar='up'), f(500, e='happy', m='grin', ar='up', p=[bub('GG', 8, -9)]), f(500, e='star', m='grin', ar='up', al='up', p=[bub('GG', 8, -9), ('spark_s', 14, 1), ('spark_s', -5, 1)])], 'Good game.')
reg(C, 'flag_plant', [f(300, e='right', m='flat', al='up'), f(200, e='happy', m='grin', al='up', p=[('flag', -4, 2)]), f(500, e='happy', m='grin', al='up', ar='up', p=[('flag', -4, 2), ('twinkle', -6, 0)])], 'Planting the flag.')
reg(C, 'first_deploy', [f(300, e='up', m='open', ar='up', p=[('rocket', 17, 3 - i * 2), ('flame', 18, 9 - i * 2, i), conf(i, 4)]) for i in range(7)], 'First deploy, rocket plus confetti.')

# ================================================================ SOCIAL (two characters)
C = 'social'
reg(C, 'wave_hello', [f(200, e='happy', m='smile', al='up', p=[bub('HI', 8, -9)], fr=dict(e='open', m='smile')), f(200, e='happy', m='smile', al='upw', p=[bub('HI', 8, -9)], fr=dict(e='happy', m='smile', ar='up')), f(200, e='happy', m='smile', al='up', p=[bub('HI', 8, -9)], fr=dict(e='happy', m='smile', ar='upw')), f(200, e='happy', m='smile', al='upw', fr=dict(e='happy', m='smile', ar='up'))], 'Hello there.')
reg(C, 'wave_goodbye', [f(220, e='happy', m='smile', al='up', fr=dict(e='happy', m='smile', ar='upw', x=2), p=[bub('BYE', 8, -9)]), f(220, e='happy', m='smile', al='upw', fr=dict(e='happy', m='smile', ar='up', x=3)), f(220, e='happy', m='smile', al='up', fr=dict(e='happy', m='smile', ar='upw', x=4)), f(220, e='happy', m='smile', al='upw', fr=dict(e='happy', m='smile', ar='up', x=5))], 'Waving goodbye.')
reg(C, 'dap_up', [
    f(250, e='happy', m='smile', fr=dict(e='happy', m='smile')),
    f(160, e='happy', m='grin', ar='far', x=1, fr=dict(e='happy', m='grin', al='far', x=-1)),
    f(160, e='happy', m='grin', ar='far', x=1, fr=dict(e='happy', m='grin', al='far', x=-1), p=[('spark_s', 12, 5), ('twinkle', 12, 10)]),
    f(300, e='happy', m='grin', ar='up', al='flex', x=1, fr=dict(e='happy', m='grin', al='up', ar='flex', x=-1), p=[('spark', 11, 1), bub('YO', 8, -9)]),
    f(250, e='closed', m='grin', ar='flex', al='flex', x=1, fr=dict(e='closed', m='grin', al='flex', ar='flex', x=-1)),
], 'The dap up.')
reg(C, 'high_five', [
    f(220, e='happy', m='smile', fr=dict(e='happy', m='smile')),
    f(160, e='happy', m='grin', ar='cheer', fr=dict(e='happy', m='grin', al='cheer'), y=-1, p=[]),
    f(200, e='star', m='grin', ar='cheer', fr=dict(e='star', m='grin', al='cheer'), y=-2, lg='tuck', p=[('spark', 12, -3)]),
    f(300, e='happy', m='grin', ar='cheer', fr=dict(e='happy', m='grin', al='cheer'), y=0, p=[('twinkle', 12, -2)]),
], 'High five.')
reg(C, 'fist_bump', [
    f(250, e='open', m='flat', fr=dict(e='open', m='flat')),
    f(200, e='open', m='smile', ar='out', x=1, fr=dict(e='open', m='smile', al='out', x=-1)),
    f(150, e='happy', m='grin', ar='far', x=1, fr=dict(e='happy', m='grin', al='far', x=-1), p=[('burst', 7, 2, 0, 'Y', 6)]),
    f(300, e='happy', m='grin', ar='far', x=1, fr=dict(e='happy', m='grin', al='far', x=-1), p=[('burst', 7, 2, 2, 'w', 6)]),
], 'Fist bump.')
reg(C, 'hug', [
    f(300, e='happy', m='smile', fr=dict(e='happy', m='smile')),
    f(300, e='closed', m='smile', al='far', ar='far', x=2, fr=dict(e='closed', m='smile', al='far', ar='far', x=-2)),
    f(450, e='closed', m='grin', al='far', ar='far', x=3, fr=dict(e='closed', m='grin', al='far', ar='far', x=-3), p=[('heart', 11, -4)]),
    f(450, e='closed', m='grin', al='far', ar='far', x=3, fr=dict(e='closed', m='grin', al='far', ar='far', x=-3), p=[('heart', 11, -6), ('heart_s', 8, -9), ('heart_s', 17, -8)]),
], 'Group hug (for two).')
reg(C, 'chat', [
    f(300, e='open', m='open', fr=dict(e='left', m='flat'), p=[bub('HEY', 8, -9)]),
    f(300, e='open', m='flat', fr=dict(e='left', m='open'), p=[bub('SUP', 24, -9, 'l')]),
    f(300, e='open', m='open', fr=dict(e='left', m='flat'), p=[bub('NICE', 8, -9)]),
    f(300, e='open', m='flat', fr=dict(e='happy', m='open'), p=[bub('YEP', 24, -9, 'l')]),
], 'Back-and-forth chat.')
reg(C, 'talking_friends', [
    f(260, e='happy', m='open', fr=dict(e='left', m='smile'), p=[bub('LOL', 8, -9)]),
    f(260, e='happy', m='smile', fr=dict(e='happy', m='open'), p=[bub('LOL', 24, -9)]),
    f(260, e='happy', m='open', fr=dict(e='happy', m='smile'), p=[bub('RIGHT', 8, -9)]),
    f(260, e='happy', m='smile', fr=dict(e='happy', m='open'), p=[bub('HA', 24, -9)]),
], 'Friends shooting the breeze.')
reg(C, 'whisper', [
    f(300, e='right', m='small', x=2, fr=dict(e='left', m='flat'), p=[txt('PSST', 3, -8, 'w')]),
    f(300, e='right', m='small', x=2, fr=dict(e='ring', m='open'), p=[txt('PSST', 3, -8, 'w'), txt('!', 12, -4, 'Y')]),
    f(300, e='right', m='small', x=2, fr=dict(e='happy', m='smile'), p=[txt('PSST', 3, -8, 'w')]),
], 'Sharing a secret.')
reg(C, 'gossip', [
    f(280, e='right', m='open', x=1, fr=dict(e='left', m='flat', x=-1), p=[txt('!', 14, -4, 'Y')]),
    f(280, e='right', m='small', x=1, fr=dict(e='ring', m='open', x=-1), p=[txt('?', 14, -4, 'Y')]),
    f(280, e='right', m='grin', x=1, fr=dict(e='happy', m='grin', x=-1), p=[txt('!', 14, -4, 'Y'), txt('?', 8, -8, 'Y')]),
], 'Did you hear?')
reg(C, 'laugh_together', [f(120, e='happy', m='grin', y=-(i % 2), fr=dict(e='happy', m='grin', y=-((i + 1) % 2)), p=[txt('HA', 6, -4 - i % 2, 'Y'), txt('HA', 24, -4 - (i + 1) % 2, 'Y')]) for i in range(8)], 'Cracking up together.')
reg(C, 'pair_programming', [f(160, e='right', ar='far' if i % 2 else 'out', fr=dict(e='left', al='far' if i % 2 == 0 else 'out'), p=[lap('code', i, 14, 6)]) for i in range(6)], 'Two Centos, one keyboard.', gap=26)
reg(C, 'handoff', [f(220, e='right', m='smile', ar='far', fr=dict(e='left', m='smile'), p=[('gift', 15 + i * 3, 6)]) for i in range(4)] + [f(400, e='happy', m='grin', fr=dict(e='happy', m='grin', al='far'), p=[('gift', 25, 6), ('spark_s', 20, 2)])], 'Passing the baton (a gift).', gap=32)
reg(C, 'share_screen', [f(300, e='right', m='smile', fr=dict(e='left', m='smile'), p=[lap('code', i, 14, 5), ('cursor', 16 + (i * 2) % 8, 4, 'c'), ('cursor', 22 - (i * 2) % 8, 6, 'p')]) for i in range(5)], 'Live shared screen with two cursors.', gap=26)
reg(C, 'cheers', [
    f(300, e='happy', m='smile', ar='up', fr=dict(e='happy', m='smile', al='up'), p=[('cup', 11, 1), ('cup', 17, 1)]),
    f(200, e='happy', m='grin', ar='up', x=1, fr=dict(e='happy', m='grin', al='up', x=-1), p=[('cup', 12, 1), ('cup', 16, 1), ('spark_s', 13, -3)]),
    f(400, e='closed', m='grin', ar='up', x=1, fr=dict(e='closed', m='grin', al='up', x=-1), p=[('cup', 12, 1), ('cup', 16, 1), ('spark', 12, -5)]),
], 'Cheers!')
reg(C, 'dance_together', [f(150, x=[-1, 0, 1, 0][i % 4], e='happy', m='grin', al='cheer' if i % 2 else 'down', ar='down' if i % 2 else 'cheer', y=-(i % 2), fr=dict(x=[1, 0, -1, 0][i % 4], e='happy', m='grin', al='down' if i % 2 else 'cheer', ar='cheer' if i % 2 else 'down', y=-(i % 2)), p=[('note', 11, -4 - i % 3), ('note_p', 14, -6 + i % 2)]) for i in range(8)], 'Dancing in sync.')
reg(C, 'tag', [f(130, e='angry', m='open', x=i * 2, lg='a' if i % 2 else 'b', fr=dict(e='ring', m='open', x=i * 2 + 2, lg='b' if i % 2 else 'a'), p=[txt('TAG', 0 + i * 2, -7, 'Y')]) for i in range(6)], 'You are it.', gap=18)
reg(C, 'argue', [
    f(200, e='angry', m='open', fr=dict(e='angry', m='flat'), p=[bub('NO', 8, -9)]),
    f(200, e='angry', m='flat', fr=dict(e='angry', m='open'), p=[bub('YES', 22, -9)]),
    f(200, e='angry', m='open', fr=dict(e='angry', m='flat'), p=[bub('NO', 8, -9), ('xmark_s', 12, 0)]),
    f(200, e='angry', m='flat', fr=dict(e='angry', m='open'), p=[bub('YES', 22, -9), ('xmark_s', 18, 0)]),
], 'Friendly disagreement.')
reg(C, 'apologize', [
    f(400, e='sad', m='frown', y=1, fr=dict(e='angry', m='flat'), p=[bub('SORRY', 8, -8)]),
    f(400, e='sad', m='frown', y=1, fr=dict(e='open', m='flat'), p=[bub('SORRY', 8, -8)]),
    f(500, e='open', m='small', fr=dict(e='happy', m='smile', ar='far'), p=[('heart', 14, -3)]),
    f(500, e='happy', m='smile', fr=dict(e='happy', m='grin'), p=[('heart', 14, -4), ('heart_s', 8, -7)]),
], 'Sorry, forgiven.')
reg(C, 'thank_you', [f(300, e='happy', m='smile', fr=dict(e='open', m='smile'), p=[bub('TY', 8, -9)]), f(400, e='closed', m='smile', y=1, fr=dict(e='happy', m='grin', ar='up'), p=[bub('TY', 8, -9), ('heart_s', 16, -5)]), f(300, e='happy', m='grin', fr=dict(e='happy', m='grin'), p=[('heart', 12, -6)])], 'Thank you!')
reg(C, 'welcome', [f(220, e='happy', m='smile', al='upw', fr=dict(e='left', m='smile', x=6 - i * 2, lg='a' if i % 2 else 'b'), p=[bub('HI', 8, -9)]) for i in range(4)] + [f(400, e='happy', m='grin', al='up', ar='up', fr=dict(e='happy', m='grin', ar='up'), p=[('heart_s', 12, -4), ('twinkle', 12, -2)])], 'Welcoming a new teammate.')
reg(C, 'invite', [f(220, e='happy', m='smile', ar='far', fr=dict(e='left', m='smile'), p=[('envelope', 15 + i * 2 if i < 3 else 21, 5 + (i % 2))]) for i in range(4)] + [f(400, e='happy', m='grin', ar='far', fr=dict(e='ring', m='open', al='far'), p=[('envelope', 21, 5), ('spark_s', 13, 1)]), f(400, e='happy', m='grin', fr=dict(e='star', m='grin', ar='up'), p=[('heart_s', 12, -3), ('check', 21, 1)])], 'Sending an invite.')
reg(C, 'join_session', [
    f(200, e='open', m='flat', fr=dict(e='none', m='none', x=0), p=[('twinkle', 17, 2)]),
    f(150, e='open', m='smile', fr=dict(e='open', m='flat', x=0), p=[('spark_s', 20, -1), ('spark_s', 27, 6)]),
    f(250, e='happy', m='smile', al='upw', fr=dict(e='happy', m='smile', ar='upw'), p=[('cursor', 30, -2, 'p')]),
    f(500, e='happy', m='grin', al='up', fr=dict(e='happy', m='grin', ar='up'), p=[bub('JOINED', 6, -9), ('cursor', 30, -2, 'p')]),
], 'A teammate joins the session.')
reg(C, 'leave_session', [
    f(250, e='happy', m='smile', al='upw', fr=dict(e='happy', m='smile', ar='upw'), p=[bub('BYE', 8, -9)]),
    f(250, e='happy', m='smile', al='up', fr=dict(e='happy', m='smile', ar='up', x=2), p=[bub('BYE', 8, -9)]),
    f(200, e='open', m='small', fr=dict(e='happy', m='smile', x=6, ar='upw', lg='tuck'), p=[('twinkle', 25, 0)]),
    f(300, e='open', m='flat', fr=None, p=[('spark_s', 26, 4), ('twinkle', 30, 7)]),
], 'A teammate leaves the session.')
reg(C, 'cursor_follow', [f(250, e=['left', 'right'][i % 2], m='smile', p=[('cursor', 14 + (i * 3) % 12, 2 + (i * 5) % 7, 'c'), ('cursor', 26 - (i * 4) % 12, 8 - (i * 2) % 6, 'p'), ('cursor', 18 + (i * 2) % 9, -3 + (i * 3) % 4, 'Y')]) for i in range(8)], 'Multiplayer cursors roaming.')
reg(C, 'nudge', [f(250, e='open', m='flat', fr=dict(e='open', m='flat')), f(200, e='open', m='smile', ar='far', x=1, fr=dict(e='ring', m='open', x=1)), f(150, e='happy', m='grin', ar='far', x=2, fr=dict(e='ring', m='open', x=3), p=[txt('!', 28, -2, 'Y')]), f(350, e='happy', m='grin', x=0, fr=dict(e='angry', m='open', x=1), p=[txt('!', 28, -2, 'Y')])], 'Poking a teammate.')
reg(C, 'pat_on_head', [f(280, e='happy', m='smile', ar='reach', y=0, fr=dict(e='closed', m='smile', y=1 - (i % 2)), p=[('heart_s', 20, -4)] if i % 2 else []) for i in range(6)], 'Pat pat.', gap=18)
reg(C, 'compliment', [f(260, e='happy', m='smile', fr=dict(e='open', m='smile'), p=[bub('NICE', 8, -9)]), f(260, e='happy', m='grin', fr=dict(e='happy', m='smile', acc=['blush']), p=[('heart', 10, -4)]), f(400, e='happy', m='grin', fr=dict(e='closed', m='grin', acc=['blush']), p=[('heart', 10, -6), ('heart_s', 20, -5)])], 'Nice work!')
reg(C, 'typing_indicator', [f(300, e='right', m='small', fr=dict(e='left', m='small'), p=[('dots', 24, -10, n)]) for n in (1, 2, 3, 3)], 'Teammate is typing...')
reg(C, 'queue_message', [f(220, e='left', m='flat', fr=dict(e='right', ar='far'), p=[('envelope', 28 - i * 2, 6), ('envelope', 32 - i * 2, 6)]) for i in range(5)] + [f(400, e='happy', m='smile', ar='up', fr=dict(e='happy', m='smile'), p=[('check', 12, 2)])], 'A message joins the queue.', gap=26)
reg(C, 'approve_together', [f(300, e='open', fr=dict(e='open')), f(300, e='happy', m='smile', ar='up', fr=dict(e='happy', m='smile', al='up'), p=[('check', 10, -4)]), f(400, e='happy', m='grin', ar='up', fr=dict(e='happy', m='grin', al='up'), p=[('check', 10, -4), ('spark_s', 12, 0)])], 'Both approve.')
reg(C, 'passing_note', [f(220, e='right', fr=dict(e='left'), ar='far', p=[('envelope', 15 + i, 6)]) for i in range(3)] + [f(350, e='happy', m='smile', fr=dict(e='ring', m='open', al='far'), p=[('envelope', 18, 6)]), f(350, e='happy', m='smile', fr=dict(e='happy', m='grin'), p=[('heart_s', 12, -3)])], 'Pass a note in class.')

# ================================================================ FUN
C = 'fun'
reg(C, 'dance', [f(140, x=[-1, 0, 1, 0][i % 4], e='happy', m='grin', al='cheer' if i % 2 else 'down', ar='down' if i % 2 else 'cheer', y=-(i % 2), p=[('note', 13, -3), ('note_p', -5, -5)] if i % 2 else [('note_p', 14, -6)]) for i in range(8)], 'Just dance.')
reg(C, 'disco', [f(150, x=[-1, 0, 1, 0][i % 4], e='happy', m='grin', al='cheer' if i % 2 else 'down', ar='down' if i % 2 else 'cheer', y=-(i % 2), p=[('disco', 4, -12), ('dot_' + 'ypcw'[i % 4], 0 + i % 3, -8 + i % 2), ('dot_' + 'cwyp'[i % 4], 11 - i % 3, -7), ('dot_' + 'pycw'[i % 4], -4, -3 + i % 3), ('dot_' + 'wcpy'[i % 4], 15, -2 - i % 3)]) for i in range(8)], 'Disco ball spinning.')
reg(C, 'headphones_vibe', [f(300, e='closed', m='smile', y=-(i % 2), acc=['headphones'], p=[('note', 14, -2 - (i % 2) * 3), ('note_p', -5, -4 + (i % 2) * 2)]) for i in range(4)], 'Vibing to music.')
reg(C, 'juggle', [f(130, e=['up', 'left', 'up', 'right'][i % 4], m='small', al='up', ar='up', p=[('ball', -1 + [0, 4, 8, 4][i % 4], -7 - [0, 2, 0, 2][i % 4]), ('ball', 5 + [4, 0, 4, 8][i % 4] - 4, -9 + [2, 0, 2, 0][i % 4]), ('ball', 9 - [0, 4, 8, 4][i % 4] + 4, -6 - [2, 0, 2, 0][i % 4])]) for i in range(8)], 'Juggling three balls.')
reg(C, 'eat_pizza', [f(300, e='dot', m='open', ar='up', p=[('pizza', 9, 9)]), f(300, e='happy', m='gasp', ar='up', p=[('pizza', 8, 6)]), f(250, e='happy', m='grin', ar='up', p=[('pizza', 8, 6)]), f(250, e='happy', m='smile', ar='up', p=[('pizza', 8, 6)]), f(300, e='closed', m='smile', ar='up', p=[('heart_s', 14, 0)])], 'Pizza break.')
reg(C, 'boba', [f(300, e='open', ar='up', p=[('boba', 12, 4)]), f(300, e='closed', m='small', ar='up', p=[('boba', 11, 4)]), f(300, e='closed', m='smile', ar='up', p=[('boba', 11, 4), ('heart_s', 15, 0)]), f(300, e='happy', m='smile', ar='up', p=[('boba', 12, 4)])], 'Sipping boba.')
reg(C, 'read_book', [f(500, e='down', m='small', p=[('book', 2, 9)]), f(300, e='left', m='small', p=[('book', 2, 9)]), f(500, e='right', m='small', p=[('book', 2, 9)]), f(300, e='happy', m='smile', p=[('book', 2, 9)])], 'Curled up with a book.')
reg(C, 'magic_wand', [f(250, e='star', m='smile', acc=['wizard'], ar='up', p=[('wand', 13, 1)]), f(250, e='star', m='grin', acc=['wizard'], ar='upw', p=[('wand', 14, 1), ('spark_s', 17, -3)]), f(250, e='star', m='grin', acc=['wizard'], ar='up', p=[('wand', 13, 1), ('spark', 18, -6), ('twinkle', 23, -2)]), f(250, e='star', m='smile', acc=['wizard'], ar='up', p=[('wand', 13, 1), ('twinkle', 17, -7)])], 'Abracadabra.')
reg(C, 'ninja', [f(160, x=i * 2, e='squint', m='none', acc=['headband'], lg='a' if i % 2 else 'b', ar='far', p=[('shuriken', 14 + i * 3, 4 - i % 2)]) for i in range(6)], 'Throwing shuriken.')
reg(C, 'superhero', [f(160, y=-1 - (i % 2), e='angry', m='grin', acc=['cape', 'mask'], al='side', ar='side', lg='tuck', p=[('hline', -6, 3 + i % 2, 4, 'w'), ('hline', 14, 6 - i % 2, 5, 'w')]) for i in range(6)], 'Up in the sky.')
reg(C, 'sneeze', [f(300, e='squint', m='small', y=0), f(300, e='closed', m='open', y=-1), f(180, e='closed', m='gasp', y=-2, p=[txt('ACHOO', 14, -4, 'w'), ('drop', 12, 3), ('drop', 14, 5)]), f(450, e='closed', m='zig', x=-1, p=[txt('ACHOO', 14, -4, 'w')])], 'Achoo!')
reg(C, 'hiccup', [f(500, e='open', m='small', y=0), f(120, e='ring', m='open', y=-2, lg='tuck', p=[txt('HIC', 14, -2, 'Y')]), f(300, e='open', m='small', y=0, p=[txt('HIC', 14, -2, 'Y')])], 'Hic!')
WALL = [('hline', -2, 5, 16, 'K')] + [('hline', -2, 6 + i, 16, 'u') for i in range(9)]
reg(C, 'hide_and_peek', [f(350, y=3, e='right', p=WALL), f(350, y=0, e='right', p=WALL), f(450, y=-2, e='left', m='small', p=WALL), f(450, y=-3, e='right', m='small', p=WALL), f(300, y=-3, e='ring', m='open', p=WALL), f(250, y=0, e='closed', p=WALL), f(250, y=3, e='closed', p=WALL)], 'Peeking over the wall.')
reg(C, 'sneak', [f(220, x=-i * 2, e='left', m='none', lg='tuck', y=1, p=[txt('...', -4 - i * 2, -3, 'w')]) for i in range(5)], 'Sneaking away.')
reg(C, 'stargaze', [f(500, e='up', m='small', p=[('stars', -4, -14, i, 20, 8), ('moon', 13, -9)]) for i in range(4)], 'Looking up at the night sky.')
reg(C, 'rainy_day', [f(250, e='up', m='smile', ar='up', p=[('umbrella', 2, -6), ('rain', -5, -9, i, 22, 21, 16)]) for i in range(5)], 'Rain, but dry under the umbrella.')
reg(C, 'sunbathe', [f(500, acc=['sunglasses'], m='smile', y=0, p=[('sun', 14, -6), ('cup', -9, 6)]) for _ in range(2)] + [f(500, acc=['sunglasses'], m='grin', al='out', ar='out', y=0, p=[('sun', 14, -6), ('cup', -9, 6), ('twinkle', 17, -1)])], 'Soaking up the sun.')
reg(C, 'fishing', [f(400, e='right', m='small', ar='far', p=[('hline', 17, 6, 1, 'w'), ('hline', 14, 15, 14, 'b'), ('hline', 16, 16, 12, 'b')]), f(300, e='ring', m='open', ar='up', y=-1, p=[('hline', 17, 6, 1, 'w'), ('hline', 14, 15, 14, 'b'), ('hline', 16, 16, 12, 'b'), ('spark_s', 18, 11)]), f(500, e='happy', m='grin', ar='up', y=-1, p=[('ball', 14, 4), ('hline', 14, 15, 14, 'b'), ('hline', 16, 16, 12, 'b')])], 'Reeling something in.')
reg(C, 'gaming', [f(110, e='squint', m='tongue', ar='far', al='far', x=i % 2, p=[('controller', 1, 9)]) for i in range(8)], 'Intense gaming session.')
reg(C, 'workout', [f(300, e='angry', m='grin', al='out', ar='out', y=0, p=[('dumbbell', 1, 7)]), f(300, e='angry', m='grin', al='up', ar='up', y=-1, p=[('dumbbell', 1, 0)]), f(300, e='angry', m='zig', al='up', ar='up', y=-1, acc=['sweat'], p=[('dumbbell', 1, 0)]), f(300, e='angry', m='grin', al='out', ar='out', y=0, p=[('dumbbell', 1, 7)])], 'Lifting heavy.')
reg(C, 'balloon_ride', [f(300, e='up', m='smile', al='up', y=-2 * i, p=[('balloon', 4, -9 - 2 * i)]) for i in range(5)], 'Floating away.')
reg(C, 'campfire', [f(300, e='happy', m='smile', p=[('flame', 14, 7, i), ('hline', 12, 12, 9, 'N')]) for i in range(4)], 'Warm by the fire.')
reg(C, 'selfie', [f(300, e='happy', m='smile', ar='up', p=[('phone', 14, 0)]), f(120, e='happy', m='grin', ar='up', p=[('phone', 14, 0), ('twinkle', 13, -3)]), f(500, e='happy', m='grin', ar='up', p=[('phone', 14, 0), ('spark_s', 13, -3)])], 'Say cheese.')
reg(C, 'texting', [f(200, e='down', m='small', ar='far' if i % 2 else 'out', p=[('phone', 14, 6 + 0)]) for i in range(6)], 'Texting.')
