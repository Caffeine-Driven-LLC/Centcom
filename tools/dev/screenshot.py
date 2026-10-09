#!/usr/bin/env python3
"""Runs the real `centcom --demo` in a pseudo-terminal, plays a few scenes and writes each as a PNG (real colours, half blocks included), so the look of the app can be checked without a terminal window.

    pip install pyte pillow
    python3 tools/dev/screenshot.py OUT_DIR [scene ...]       # scenes: welcome chat approval settings palette help narrow busy error ask (add -light for the light theme)

Uses a throwaway HOME. Needs a monospace font; set CENTCOM_FONT to a .ttf path to choose one."""
import importlib.util, os, sys, glob
from PIL import Image, ImageDraw, ImageFont
spec = importlib.util.spec_from_file_location('ps', os.path.join(os.path.dirname(__file__), 'pty-smoke.py')); ps = importlib.util.module_from_spec(spec); spec.loader.exec_module(ps)

NAMED = {'black': (0, 0, 0), 'red': (205, 49, 49), 'green': (13, 188, 121), 'brown': (229, 229, 16), 'blue': (36, 114, 200), 'magenta': (188, 63, 188), 'cyan': (17, 168, 205), 'white': (229, 229, 229),
         'brightblack': (102, 102, 102), 'brightred': (241, 76, 76), 'brightgreen': (35, 209, 139), 'brightbrown': (245, 245, 67), 'brightblue': (59, 142, 234), 'brightmagenta': (214, 112, 214), 'brightcyan': (41, 184, 219), 'brightwhite': (255, 255, 255)}
def rgb(c, default):
    if c == 'default': return default
    if c in NAMED: return NAMED[c]
    if len(c) == 6:
        try: return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16))
        except ValueError: pass
    return default

def font_path():
    p = os.environ.get('CENTCOM_FONT')
    if p: return p
    for pat in ['~/.local/share/fonts/JetBrains/JetBrainsMonoNerdFont-Regular.ttf', '/usr/share/fonts/**/DejaVuSansMono.ttf', '/usr/share/fonts/**/NotoSansMono-Regular.ttf', '/usr/share/fonts/**/*Mono*.ttf']:
        g = glob.glob(os.path.expanduser(pat), recursive=True)
        if g: return g[0]
    raise SystemExit('no monospace font found; set CENTCOM_FONT')

def render(screen, path, bg0=(10, 10, 12), fg0=(228, 228, 231), cw=10, ch=20):
    f = ImageFont.truetype(font_path(), 16); bold = f
    w, h = screen.columns * cw, screen.lines * ch; im = Image.new('RGB', (w, h), bg0); d = ImageDraw.Draw(im)
    for y in range(screen.lines):
        row = screen.buffer[y]
        for x in range(screen.columns):
            c = row[x]; fg = rgb(c.fg, fg0); bg = rgb(c.bg, bg0)
            if c.reverse: fg, bg = bg, fg
            if bg != bg0: d.rectangle([x * cw, y * ch, (x + 1) * cw - 1, (y + 1) * ch - 1], fill=bg)
            g = c.data
            if g == ' ' or not g: continue
            if g == '▀': d.rectangle([x * cw, y * ch, (x + 1) * cw - 1, y * ch + ch // 2 - 1], fill=fg); continue
            if g == '▄': d.rectangle([x * cw, y * ch + ch // 2, (x + 1) * cw - 1, (y + 1) * ch - 1], fill=fg); continue
            if g == '█': d.rectangle([x * cw, y * ch, (x + 1) * cw - 1, (y + 1) * ch - 1], fill=fg); continue
            d.text((x * cw, y * ch + 1), g, font=f, fill=fg)
    im.save(path)

def session(rows=36, cols=112, **kw):
    t = ps.Term([ps.BIN, '--demo'], rows=rows, cols=cols, env_extra={'CENTCOM_NO_UPDATE_CHECK': '1', 'COLORTERM': 'truecolor', **kw.get('env', {})}); t.pump(4.5); return t

def main():
    out = sys.argv[1] if len(sys.argv) > 1 else '.'; os.makedirs(out, exist_ok=True); want = sys.argv[2:] or ['welcome', 'chat', 'approval', 'settings', 'palette', 'help', 'narrow']
    for name in want:
        light = name.endswith('-light'); name = name[:-6] if light else name; tag = name + ('-light' if light else '')
        t = session(rows=28, cols=70) if name == 'narrow' else session(env={'CENTO_THEME': 'light'} if light else {})
        if name == 'welcome': pass
        elif name == 'chat': t.send('\r', 0.5); t.send('/demo search\r', 7.0)
        elif name == 'narrow': t.send('\r', 0.5); t.send('/demo search\r', 7.0)
        elif name == 'approval': t.send('\r', 0.5); t.send('/demo fix\r', 9.0)
        elif name == 'settings': t.send('\r', 0.5); t.send('/settings\r', 1.5)
        elif name == 'palette': t.send('\r', 0.5); t.send('\x0b', 1.2)
        elif name == 'busy': t.send('\r', 0.5); t.send('/demo fix\r', 3.2)
        elif name == 'error': t.send('\r', 0.5); t.send('/demo error\r', 4.0)
        elif name == 'ask': t.send('\r', 0.5); t.send('/demo ask\r', 7.0)
        elif name == 'night': t.send('\r', 0.5); t.send('\x0e', 1.5)
        elif name == 'models': t.send('\r', 0.5); t.send('/model\r', 1.5)
        elif name == 'usage': t.send('\r', 0.5); t.send('/demo search\r', 6.0); t.send('/usage\r', 1.5)
        elif name == 'fleet': t.send('\r', 0.5); t.send('/demo search\r', 6.0); t.send('\x02', 1.5)
        elif name == 'cento': t.send('\r', 0.5); t.send('/cento\r', 1.5)
        elif name == 'help': t.send('\r', 0.5); t.send('?', 1.2)
        render(t.screen, os.path.join(out, tag + '.png'), **({'bg0': (246, 246, 247), 'fg0': (24, 24, 27)} if light else {})); t.close(); print('wrote', os.path.join(out, tag + '.png'))
if __name__ == '__main__': main()
