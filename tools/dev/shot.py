#!/usr/bin/env python3
"""Run the TUI in a pseudo-terminal, feed it keystrokes, and save what the screen shows as a PNG (and a text dump).
Needs `pip install pyte pillow`. Example:
  python3 tools/dev/shot.py --size 120x38 --out /tmp/a.png --steps 'wait:2;send:/demo fix\\r;wait:6' -- pnpm centcom --demo
Step grammar (separated by ';'): wait:SECONDS · send:TEXT (\\r \\n \\t \\e \\xNN escapes) · shot:FILE.png (snapshot now)"""
import argparse, fcntl, os, pty, re, select, signal, struct, sys, termios, time
import pyte
from PIL import Image, ImageDraw, ImageFont

FONT = next((p for p in ['/home/devlsx/.local/share/fonts/JetBrains/JetBrainsMonoNerdFontMono-Regular.ttf', '/usr/share/fonts/TTF/JetBrainsMono-Regular.ttf', '/usr/share/fonts/noto/NotoSansMono-Regular.ttf', '/usr/share/fonts/TTF/DejaVuSansMono.ttf'] if os.path.exists(p)), None)
BOLD = FONT.replace('Regular', 'Bold') if FONT and os.path.exists(FONT.replace('Regular', 'Bold')) else FONT
NAMED = {'black': '000000', 'red': 'cd3131', 'green': '0dbc79', 'brown': 'e5e510', 'blue': '2472c8', 'magenta': 'bc3fbc', 'cyan': '11a8cd', 'white': 'e5e5e5',
         'brightblack': '666666', 'brightred': 'f14c4c', 'brightgreen': '23d18b', 'brightbrown': 'f5f543', 'brightblue': '3b8eea', 'brightmagenta': 'd670d6', 'brightcyan': '29b8db', 'brightwhite': 'ffffff'}
DEFAULT_BG, DEFAULT_FG = '0a0a0c', 'ececef'

def color(c, default):
    if c == 'default': return default
    if c in NAMED: return NAMED[c]
    return c if re.fullmatch(r'[0-9a-fA-F]{6}', c) else default

def render(screen, path, cw=9, ch=19, size=15):
    f = ImageFont.truetype(FONT, size); fb = ImageFont.truetype(BOLD, size)
    img = Image.new('RGB', (screen.columns * cw, screen.lines * ch), '#' + DEFAULT_BG); d = ImageDraw.Draw(img)
    for y in range(screen.lines):
        row = screen.buffer[y]
        for x in range(screen.columns):
            c = row[x]; fg = color(c.fg, DEFAULT_FG); bg = color(c.bg, DEFAULT_BG)
            if c.reverse: fg, bg = bg, fg
            if bg != DEFAULT_BG: d.rectangle([x * cw, y * ch, (x + 1) * cw - 1, (y + 1) * ch - 1], fill='#' + bg)
            g = c.data
            if g == '▀': d.rectangle([x * cw, y * ch, (x + 1) * cw - 1, y * ch + ch // 2 - 1], fill='#' + fg)
            elif g == '▄': d.rectangle([x * cw, y * ch + ch // 2, (x + 1) * cw - 1, (y + 1) * ch - 1], fill='#' + fg)
            elif g == '█': d.rectangle([x * cw, y * ch, (x + 1) * cw - 1, (y + 1) * ch - 1], fill='#' + fg)
            elif g.strip():
                if c.italics: pass
                d.text((x * cw, y * ch), g, font=fb if c.bold else f, fill='#' + fg)
    img.save(path)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--size', default='120x38'); ap.add_argument('--out', required=True); ap.add_argument('--steps', default='wait:2'); ap.add_argument('--text', action='store_true'); ap.add_argument('cmd', nargs=argparse.REMAINDER)
    a = ap.parse_args(); cols, rows = map(int, a.size.split('x')); cmd = [c for c in a.cmd if c != '--']
    screen = pyte.Screen(cols, rows); stream = pyte.ByteStream(screen)
    pid, fd = pty.fork()
    if pid == 0:
        env = dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor', COLUMNS=str(cols), LINES=str(rows)); env.pop('NO_COLOR', None)
        os.execvpe(cmd[0], cmd, env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0)); os.kill(pid, signal.SIGWINCH)
    def pump(sec):
        end = time.time() + sec
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try: data = os.read(fd, 65536)
                except OSError: return False
                if not data: return False
                stream.feed(data)
        return True
    def dump():
        return '\n'.join(''.join(screen.buffer[y][x].data for x in range(cols)).rstrip() for y in range(rows))
    n = 0
    for step in [s for s in a.steps.split(';') if s]:
        kind, _, val = step.partition(':')
        if kind == 'wait': pump(float(val))
        elif kind == 'send':
            val = val.encode().decode('unicode_escape').replace('\\e', '\x1b') if '\\' in val else val
            # one key at a time, like a person typing (Ink treats a multi-char chunk as a paste); escape sequences stay whole
            for k in re.findall(r'\x1b\[[0-9;]*[A-Za-z~]|\x1b.|.', val, re.S):
                os.write(fd, k.encode()); pump(0.02)
            pump(0.15)
        elif kind == 'shot':
            render(screen, val); n += 1
    pump(0.2); render(screen, a.out)
    if a.text: print(dump())
    try: os.kill(pid, signal.SIGKILL)
    except ProcessLookupError: pass
    os.waitpid(pid, 0)
if __name__ == '__main__': main()
