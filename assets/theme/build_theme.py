#!/usr/bin/env python3
"""Single source of truth for the Cento "Abyss / Shallows" theme.
Writes tokens.json, theme.css, tailwind.preset.js, terminal/*, state-map.json, CONTRAST.md."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# ------------------------------------------------------------------ raw palette
RAMPS = {
    'abyss': {  # the deep-sea blues: surfaces and borders
        '950': '#07091A', '900': '#0B1026', '850': '#0F1632', '800': '#141C3E', '700': '#1C2650',
        '600': '#2A3568', '500': '#3D4A85', '400': '#7384CC', '300': '#A9B6E8', '200': '#C9D2F5', '100': '#E6EBFF', '50': '#F3F6FF',
    },
    'cento': {  # the mascot's violet-blue
        '100': '#E4DDFF', '200': '#C3B3FF', '300': '#A892FF', '400': '#8F74FF', '500': '#7C5CFF', '600': '#5A3FD1', '700': '#3B2A8C', '800': '#271C5E',
    },
    'current': {  # open-water blue
        '100': '#DCEEFF', '200': '#9FD0FF', '300': '#7DBAFF', '400': '#5AA9FF', '500': '#2E78D4', '600': '#1B5FB8', '700': '#1B4F9C', '800': '#12336A',
    },
    'glow': {  # bioluminescent mint: signals, the antenna
        '200': '#8CF8E0', '300': '#5FF5D2', '400': '#3DF2C8', '500': '#1FD3A8', '600': '#0B8F73', '700': '#086654',
    },
    'ink': {'900': '#1B1530', '800': '#2B1B14'},
}
STATUS = {  # dark / light
    'success': ('#4ADE80', '#14733A'), 'warning': ('#FFD166', '#8A5A00'),
    'danger': ('#FF5C5C', '#C21B1B'), 'info': ('#5AA9FF', '#1B5FB8'),
}
PRESENCE = {'violet': '#7C5CFF', 'red': '#FF2D2D', 'yellow': '#FFD500', 'green': '#22C55E', 'brown': '#8B5A2B'}

def A(r, k): return RAMPS[r][k]

SEMANTIC = {
    'bg.base':        (A('abyss', '950'), A('abyss', '50')),
    'bg.surface':     (A('abyss', '900'), '#FFFFFF'),
    'bg.raised':      (A('abyss', '850'), '#FFFFFF'),
    'bg.overlay':     (A('abyss', '800'), '#FFFFFF'),
    'bg.sunken':      ('#050716', '#E8EDFB'),
    'bg.hover':       (A('abyss', '800'), '#EAEFFF'),
    'bg.selected':    (A('abyss', '700'), '#DDE4FF'),
    'border.subtle':  (A('abyss', '700'), '#D5DCF5'),
    'border.default': (A('abyss', '600'), '#B8C2EA'),
    'border.strong':  (A('abyss', '500'), '#7E8CCB'),
    'text.primary':   (A('abyss', '100'), '#0B1026'),
    'text.secondary': (A('abyss', '300'), '#3B4678'),
    'text.muted':     (A('abyss', '400'), '#56649F'),
    'text.inverse':   (A('abyss', '950'), '#FFFFFF'),
    'text.link':      (A('current', '300'), A('current', '600')),
    'accent.primary': (A('cento', '500'), A('cento', '600')),
    'accent.fill':    ('#6B49F0', A('cento', '600')),
    'accent.hover':   (A('cento', '400'), '#4A30B8'),
    'accent.active':  (A('cento', '600'), A('cento', '700')),
    'accent.subtle':  (A('cento', '800'), '#E9E3FF'),
    'accent.on':      ('#FFFFFF', '#FFFFFF'),
    'signal':         (A('glow', '400'), '#07765F'),
    'signal.subtle':  ('#0A2A2A', '#DDFBF3'),
    'focus.ring':     (A('glow', '400'), A('cento', '600')),
}
for k, (d, l) in STATUS.items():
    SEMANTIC['status.' + k] = (d, l)
    SEMANTIC['status.%s.subtle' % k] = ({'success': '#0E2A1A', 'warning': '#2E2408', 'danger': '#33121A', 'info': '#0F2342'}[k],
                                        {'success': '#DDF7E6', 'warning': '#FFF3D1', 'danger': '#FFE0E0', 'info': '#DCEBFF'}[k])

# ------------------------------------------------------------------ contrast
def lum(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= .03928 else ((x + .055) / 1.055) ** 2.4 for x in c]
    return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]
def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + .05) / (lb + .05)

PAIRS = [  # (fg, bg, minimum, note)
    ('text.primary', 'bg.base', 7, 'body text'), ('text.primary', 'bg.surface', 7, 'body text on cards'),
    ('text.primary', 'bg.overlay', 7, 'body text in modals'), ('text.secondary', 'bg.base', 4.5, 'secondary text'),
    ('text.secondary', 'bg.surface', 4.5, 'secondary text on cards'), ('text.muted', 'bg.base', 4.5, 'muted text / placeholders'),
    ('text.muted', 'bg.surface', 4.5, 'muted text on cards'), ('text.link', 'bg.base', 4.5, 'links'),
    ('accent.on', 'accent.fill', 4.5, 'button label on filled accent'), ('accent.fill', 'bg.base', 3, 'filled accent edge against the page'), ('accent.primary', 'bg.base', 3, 'accent as UI edge / icon (non-text)'),
    ('accent.hover', 'bg.base', 3, 'accent hover as UI edge'), ('signal', 'bg.base', 4.5, 'signal text'),
    ('status.success', 'bg.surface', 4.5, 'success text'), ('status.warning', 'bg.surface', 4.5, 'warning text'),
    ('status.danger', 'bg.surface', 4.5, 'danger text'), ('status.info', 'bg.surface', 4.5, 'info text'),
    ('status.success', 'status.success.subtle', 4.5, 'success on its tint'), ('status.danger', 'status.danger.subtle', 4.5, 'danger on its tint'),
    ('focus.ring', 'bg.base', 3, 'focus ring'), ('border.default', 'bg.base', 1.5, 'decorative border (not required)'),
]

def contrast_md():
    out = ['| Pair | Dark | Light | Target | Note |', '|---|---|---|---|---|']
    bad = []
    for fg, bg, mn, note in PAIRS:
        rd = ratio(SEMANTIC[fg][0], SEMANTIC[bg][0]); rl = ratio(SEMANTIC[fg][1], SEMANTIC[bg][1])
        ok = lambda r: '✅' if r >= mn else '❌'
        out.append(f'| `{fg}` on `{bg}` | {rd:.2f} {ok(rd)} | {rl:.2f} {ok(rl)} | ≥ {mn} | {note} |')
        if rd < mn: bad.append((fg, bg, 'dark', rd))
        if rl < mn: bad.append((fg, bg, 'light', rl))
    return '\n'.join(out), bad

# ------------------------------------------------------------------ typography / spacing / motion / shape
TYPE = {
    'font': {
        'mono': "'JetBrains Mono', 'Berkeley Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        'sans': "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        'pixel': "'Silkscreen', 'Pixelify Sans', 'Press Start 2P', ui-monospace, monospace",
    },
    'scale': {  # px / line-height px / weight
        'xs': (11, 16, 400), 'sm': (12, 18, 400), 'base': (14, 22, 400), 'md': (16, 24, 400),
        'lg': (18, 28, 500), 'xl': (22, 30, 600), '2xl': (28, 36, 600), '3xl': (36, 44, 700), 'display': (56, 60, 700),
    },
}
SPACE = {str(i): i * 4 for i in (0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32)}
RADIUS = {'none': 0, 'px': 2, 'sm': 4, 'md': 8, 'lg': 12, 'pill': 999}
MOTION = {
    'duration': {'instant': 0, 'fast': 80, 'base': 160, 'slow': 280, 'slower': 480, 'mascot-tick': 120},
    'easing': {'standard': 'cubic-bezier(.2,0,0,1)', 'enter': 'cubic-bezier(0,0,.2,1)', 'exit': 'cubic-bezier(.4,0,1,1)', 'pixel': 'steps(4,end)'},
}
SHADOW = {'pixel-sm': '2px 2px 0 0 {shadow}', 'pixel-md': '4px 4px 0 0 {shadow}', 'glow-signal': '0 0 0 1px {signal}, 0 0 16px {signalglow}'}
BREAKPOINTS = {'sm': 480, 'md': 768, 'lg': 1024, 'xl': 1280, '2xl': 1600}

# ------------------------------------------------------------------ outputs
def tokens_json():
    return {
        '$name': 'Cento Abyss/Shallows', '$version': '1.0.0',
        'palette': RAMPS, 'status': {k: {'dark': d, 'light': l} for k, (d, l) in STATUS.items()}, 'presence': PRESENCE,
        'semantic': {k: {'dark': d, 'light': l} for k, (d, l) in SEMANTIC.items()},
        'typography': {'font': TYPE['font'], 'scale': {k: {'size': s, 'line': lh, 'weight': w} for k, (s, lh, w) in TYPE['scale'].items()}},
        'space': SPACE, 'radius': RADIUS, 'motion': MOTION, 'breakpoints': BREAKPOINTS,
    }

def css():
    def block(idx):
        lines = []
        for k, v in SEMANTIC.items():
            lines.append(f'  --{k.replace(".", "-")}: {v[idx]};')
        return '\n'.join(lines)
    ramps = '\n'.join(f'  --{r}-{k}: {v};' for r, d in RAMPS.items() for k, v in d.items())
    pres = '\n'.join(f'  --presence-{k}: {v};' for k, v in PRESENCE.items())
    ty = '\n'.join(f'  --font-{k}: {v};' for k, v in TYPE['font'].items())
    sc = '\n'.join(f'  --text-{k}: {s}px/{lh}px;\n  --text-{k}-weight: {w};' for k, (s, lh, w) in TYPE['scale'].items())
    sp = '\n'.join(f'  --space-{k}: {v}px;' for k, v in SPACE.items())
    ra = '\n'.join(f'  --radius-{k}: {v}px;' for k, v in RADIUS.items())
    mo = '\n'.join([f'  --dur-{k}: {v}ms;' for k, v in MOTION['duration'].items()] + [f'  --ease-{k}: {v};' for k, v in MOTION['easing'].items()])
    return f'''/* Cento theme: generated by build_theme.py. Do not edit by hand. */
:root {{
  color-scheme: dark;
{ramps}
{pres}
{ty}
{sc}
{sp}
{ra}
{mo}
  --shadow-pixel-sm: 2px 2px 0 0 #000000a0;
  --shadow-pixel-md: 4px 4px 0 0 #000000a0;
  --shadow-glow-signal: 0 0 0 1px var(--signal), 0 0 16px #3df2c855;
/* Abyss (dark) is the default */
{block(0)}
}}
:root[data-theme="light"] {{
  color-scheme: light;
{block(1)}
  --shadow-pixel-sm: 2px 2px 0 0 #0b102620;
  --shadow-pixel-md: 4px 4px 0 0 #0b102620;
  --shadow-glow-signal: 0 0 0 1px var(--signal), 0 0 12px #0b8f7333;
}}
@media (prefers-color-scheme: light) {{
  :root:not([data-theme="dark"]) {{
    color-scheme: light;
{block(1).replace(chr(10), chr(10) + "  ")}
  }}
}}
@media (prefers-reduced-motion: reduce) {{
  :root {{ --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; --dur-slower: 0ms; --dur-mascot-tick: 0ms; }}
  .cento-anim {{ animation: none !important; }}
}}
'''

def tailwind():
    colors = {r: {k: v for k, v in d.items()} for r, d in RAMPS.items()}
    sem = {}
    for k in SEMANTIC:
        sem[k.replace('.', '-')] = f'var(--{k.replace(".", "-")})'
    return ('/* Cento theme: generated by build_theme.py. Do not edit by hand. */\n'
            'module.exports = {\n  theme: { extend: {\n    colors: ' + json.dumps({**colors, **sem, 'presence': PRESENCE}, indent=6).replace('\n', '\n    ') + ',\n'
            '    fontFamily: ' + json.dumps({k: [x.strip().strip("'") for x in v.split(',')] for k, v in TYPE['font'].items()}) + ',\n'
            '    borderRadius: ' + json.dumps({k: f'{v}px' for k, v in RADIUS.items()}) + ',\n'
            '    transitionDuration: ' + json.dumps({k: f'{v}ms' for k, v in MOTION['duration'].items()}) + ',\n'
            '    transitionTimingFunction: ' + json.dumps(MOTION['easing']) + ',\n'
            '    boxShadow: { "pixel-sm": "var(--shadow-pixel-sm)", "pixel-md": "var(--shadow-pixel-md)", "glow-signal": "var(--shadow-glow-signal)" },\n'
            '  } },\n};\n')

ANSI = {
    'background': A('abyss', '950'), 'foreground': A('abyss', '100'), 'cursor': A('glow', '400'), 'cursor_text': A('abyss', '950'),
    'selection_bg': A('abyss', '600'), 'selection_fg': A('abyss', '50'),
    'normal': ['#0B1026', '#FF5C5C', '#4ADE80', '#FFD166', '#5AA9FF', '#A892FF', '#3DF2C8', '#A9B6E8'],
    'bright': ['#3D4A85', '#FF8A8A', '#86EFAC', '#FFE29A', '#9FD0FF', '#C3B3FF', '#8CF8E0', '#E6EBFF'],
}
ANSI_NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

def alacritty():
    n = '\n'.join(f'{nm} = "{c}"' for nm, c in zip(ANSI_NAMES, ANSI['normal']))
    b = '\n'.join(f'{nm} = "{c}"' for nm, c in zip(ANSI_NAMES, ANSI['bright']))
    return f'''# Cento Abyss for Alacritty. Generated by build_theme.py.
[colors.primary]
background = "{ANSI['background']}"
foreground = "{ANSI['foreground']}"

[colors.cursor]
cursor = "{ANSI['cursor']}"
text = "{ANSI['cursor_text']}"

[colors.selection]
background = "{ANSI['selection_bg']}"
text = "{ANSI['selection_fg']}"

[colors.normal]
{n}

[colors.bright]
{b}
'''

def kitty():
    lines = [f"background {ANSI['background']}", f"foreground {ANSI['foreground']}", f"cursor {ANSI['cursor']}", f"cursor_text_color {ANSI['cursor_text']}",
             f"selection_background {ANSI['selection_bg']}", f"selection_foreground {ANSI['selection_fg']}", 'url_color ' + A('current', '300')]
    for i, c in enumerate(ANSI['normal'] + ANSI['bright']):
        lines.append(f'color{i} {c}')
    return '# Cento Abyss for kitty. Generated by build_theme.py.\n' + '\n'.join(lines) + '\n'

# UI state -> mascot animation (validated against ../mascot/animations.json)
STATE_MAP = {
    'idle': 'idle_breathe', 'ready': 'ready_prompt', 'listening': 'voice_listening', 'prompt-received': 'prompt_received',
    'thinking': 'thinking', 'thinking-hard': 'thinking_hard', 'planning': 'plan_mode', 'searching': 'searching',
    'reading-file': 'reading_file', 'editing-file': 'editing_file', 'creating-file': 'creating_file', 'deleting-file': 'deleting_file',
    'running-command': 'running_command', 'tool-running': 'tool_running', 'streaming': 'streaming_response',
    'awaiting-approval': 'permission_prompt', 'approved': 'tool_approve', 'denied': 'tool_deny', 'asking-question': 'asking_question',
    'compacting': 'compacting', 'context-full': 'context_full', 'background-task': 'background_task', 'sub-agent': 'sub_agent_spawn',
    'saving': 'session_saved', 'success': 'thumbs_up', 'celebrate': 'celebrate', 'error': 'error', 'crash': 'crash',
    'warning': 'worried', 'offline': 'offline', 'reconnecting': 'reconnecting', 'online': 'back_online', 'auth-required': 'auth_needed',
    'session-expired': 'session_expired', 'rate-limited': 'rate_limited', 'quota-reached': 'quota_reached', 'cost-alert': 'cost_alert',
    'update-available': 'update_available', 'first-run': 'first_run_welcome', 'empty': 'empty_state', 'no-results': 'no_results',
    'sleeping': 'sleeping', 'away': 'status_away', 'tests-pass': 'tests_passing', 'tests-fail': 'tests_failing',
    'ci-running': 'ci_running', 'ci-pass': 'ci_passed', 'ci-fail': 'ci_failed', 'pr-open': 'pr_open', 'pr-merged': 'pr_merged',
    'deploying': 'deploy', 'merge-conflict': 'merge_conflict', 'host-session': 'master_session', 'teammate-joins': 'join_session',
    'teammate-leaves': 'leave_session', 'teammate-typing': 'typing_indicator', 'message-queued': 'queue_position',
    'handoff': 'handoff', 'pair-working': 'pair_programming', 'high-five': 'high_five', 'welcome-teammate': 'welcome',
}

def main():
    md, bad = contrast_md()
    json.dump(tokens_json(), open(f'{HERE}/tokens.json', 'w'), indent=2)
    open(f'{HERE}/theme.css', 'w').write(css())
    open(f'{HERE}/tailwind.preset.js', 'w').write(tailwind())
    open(f'{HERE}/terminal/alacritty.toml', 'w').write(alacritty())
    open(f'{HERE}/terminal/kitty.conf', 'w').write(kitty())
    json.dump(ANSI, open(f'{HERE}/terminal/ansi.json', 'w'), indent=2)
    open(f'{HERE}/CONTRAST.md', 'w').write('# Contrast report\n\nGenerated by build_theme.py (WCAG 2.1 relative luminance).\n\n' + md + '\n')
    anim = {a['name'] for a in json.load(open(f'{HERE}/../mascot/animations.json'))['animations']}
    missing = {s: a for s, a in STATE_MAP.items() if a not in anim}
    json.dump(STATE_MAP, open(f'{HERE}/state-map.json', 'w'), indent=2)
    print('contrast failures:', bad or 'none')
    print('state-map entries:', len(STATE_MAP), 'missing animations:', missing or 'none')
    return md

if __name__ == '__main__':
    main()
