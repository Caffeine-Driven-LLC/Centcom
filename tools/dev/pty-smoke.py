#!/usr/bin/env python3
"""Runs the real `centcom` in a pseudo-terminal and checks what unit tests cannot: the alternate screen, mouse reporting, the tab title, the editor round trip,
ctrl+z / bg / fg with a real shell, what a kill leaves behind, and plain-text mode. Every run uses a throwaway HOME, so nothing of yours is touched.

    pip install pyte
    python3 tools/dev/pty-smoke.py            # all checks
    python3 tools/dev/pty-smoke.py editor     # only the checks whose name contains "editor"

Exit code 0 when every check passed. The demo agent is used, so no login or model is needed."""
import fcntl, os, pty, re, select, shutil, signal, struct, sys, tempfile, termios, time
import pyte

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BIN = os.path.join(ROOT, 'bin', 'centcom')

class Term:
    def __init__(self, argv, env_extra=None, cwd='/tmp', rows=28, cols=100, home=None):
        self.own_home = home is None; self.home = home or tempfile.mkdtemp(prefix='centcom-smoke-')
        env = dict(os.environ, TERM='xterm-256color', COLORTERM='truecolor', HOME=self.home, XDG_CONFIG_HOME=self.home + '/c', XDG_STATE_HOME=self.home + '/s', XDG_DATA_HOME=self.home + '/d')
        env.update(env_extra or {})
        self.screen = pyte.Screen(cols, rows); self.stream = pyte.ByteStream(self.screen); self.raw = b''
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(cwd); os.execvpe(argv[0], argv, env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    def pump(self, secs=0.6):
        end = time.time() + secs
        while time.time() < end:
            r, _, _ = select.select([self.fd], [], [], 0.05)
            if r:
                try: d = os.read(self.fd, 65536)
                except OSError: return
                self.raw += d; self.stream.feed(d)
    def send(self, data, wait=0.5):
        os.write(self.fd, data if isinstance(data, bytes) else data.encode()); self.pump(wait)
    def text(self): return '\n'.join(l.rstrip() for l in self.screen.display).rstrip()
    def mark(self): self.raw = b''
    def titles(self): return [m.decode() for m in re.findall(rb'\x1b\]0;([^\x07]*)\x07', self.raw)]
    def close(self):
        try: os.kill(self.pid, signal.SIGKILL)
        except Exception: pass
        try: os.waitpid(self.pid, 0)
        except Exception: pass
        if self.own_home: shutil.rmtree(self.home, ignore_errors=True)

CHECKS = []
def check(fn): CHECKS.append(fn); return fn
def start(**kw):
    t = Term([BIN, '--demo'], **kw); t.pump(4.5); return t

@check
def starts_and_restores_on_quit():
    t = start(); ok = b'\x1b[?1049h' in t.raw and b'\x1b[?1000h' in t.raw and b'\x1b[22;0t' in t.raw; t.mark(); t.send('/quit\r', 1.5)
    t.close(); return ok and b'\x1b[?1049l' in t.raw and b'\x1b[?1000l' in t.raw and b'\x1b[23;0t' in t.raw, 'alternate screen, mouse reporting and the saved title all come back'

@check
def kill_restores_the_terminal():
    for sig in (signal.SIGTERM, signal.SIGHUP):
        t = start(); t.mark(); os.kill(t.pid, sig); t.pump(1.2)
        if not (b'\x1b[?1049l' in t.raw and b'\x1b[?1000l' in t.raw and b'\x1b[?25h' in t.raw): t.close(); return False, f'{sig.name} left the terminal in the alternate screen'
        t.close()
    return True, 'SIGTERM and SIGHUP leave the terminal as it was'

@check
def tab_title_follows_the_agent():
    t = start(cwd=tempfile.mkdtemp(prefix='shop-')); first = t.titles()[-1] if t.titles() else ''; t.mark(); t.send('/demo fix\r', 6.0)
    seen = t.titles(); t.close(); return ('Centcom' in first and any('needs you' in x for x in seen)), f'first title "{first}", then {len(seen)} updates including "needs you"'

@check
def palette_and_settings_lists():
    t = start(); t.send('\x0b', 0.8); t.send('thm hc', 1.0); a = '/theme hc' in t.text(); t.send('\x1b', 0.4); t.send('/settings\r', 1.0); b = 'Settings' in t.text() and 'Theme:' in t.text()
    t.close(); return a and b, 'ctrl+k finds "/theme hc" from "thm hc"; /settings lists every setting'

@check
def click_on_a_list_row():
    t = start(); t.send('/mode\r', 1.0); pos = next(((l.index('plan') + 1, i + 1) for i, l in enumerate(t.screen.display) if 'plan' in l), None)
    if not pos: t.close(); return False, 'no "plan" row on screen'
    t.send(f'\x1b[<0;{pos[0]};{pos[1]}M'.encode(), 0.3); t.send(f'\x1b[<0;{pos[0]};{pos[1]}m'.encode(), 1.0); ok = 'plan' in t.text().split('\n')[-1]; t.close(); return ok, 'a mouse click on "plan" switched the permission mode'

@check
def editor_round_trip():
    ed = os.path.join(tempfile.mkdtemp(prefix='ed-'), 'ed.sh'); open(ed, 'w').write('#!/bin/sh\nprintf "\\nfrom the editor\\n" >> "$1"\n'); os.chmod(ed, 0o755)
    t = start(env_extra={'EDITOR': ed, 'VISUAL': ''}); t.send('my draft', 0.4); t.mark(); t.send('\x07', 2.5)
    ok = b'\x1b[?1049l' in t.raw and b'\x1b[?1049h' in t.raw[t.raw.find(b'\x1b[?1049l'):] and 'from the editor' in t.text() and 'my draft' in t.text(); t.close(); return ok, 'ctrl+g left the screen, ran the editor, and brought the result back into the prompt'

@check
def job_control_with_a_real_shell():
    t = Term(['bash', '--norc', '--noprofile', '-i'], env_extra={'PS1': 'SHELL$ '}); t.pump(1.0); t.send(f'{BIN} --demo\r', 5.0)
    t.mark(); t.send('\x1a', 2.0); stopped = 'Stopped' in t.raw.decode('utf8', 'ignore')
    t.mark(); t.send('bg\r', 2.5); quiet = b'\x1b[?1049h' not in t.raw and 'SHELL$' in t.text()
    t.mark(); t.send('fg\r', 3.5); back = b'\x1b[?1049h' in t.raw; t.send('\x0b', 1.0); alive = 'type to search' in t.text() or 'Recent' in t.text()
    t.close(); return stopped and quiet and back and alive, f'stopped={stopped} bg-did-not-draw={quiet} fg-redraws={back} responsive={alive}'

@check
def screen_reader_mode_is_plain_text():
    t = Term([BIN, '--screen-reader', '--demo']); t.pump(4.0); t.send('/demo fix\r', 7.0); t.send('y\r', 4.0); txt = t.raw.decode('utf8', 'ignore'); t.close()
    return '\x1b' not in txt and 'Allow Cento to' in txt and '[y/n/a]' in txt, 'no escape code at all; approvals asked as [y/n/a]'

@check
def bad_command_line_is_one_line():
    r = []
    for args, msg in ((['--bogus'], 'Unknown option'), (['--theme', 'purple'], 'must be one of')):
        t = Term([BIN] + args); t.pump(2.5); r.append(msg in t.text()); t.close()
    return all(r), 'unknown options and bad values are named, then the app exits'

if __name__ == '__main__':
    only = sys.argv[1] if len(sys.argv) > 1 else ''
    failed = 0
    for fn in CHECKS:
        if only and only not in fn.__name__: continue
        try: ok, note = fn()
        except Exception as e: ok, note = False, f'raised {e!r}'
        print(('PASS ' if ok else 'FAIL ') + fn.__name__.replace('_', ' ') + ' - ' + note); failed += 0 if ok else 1
    sys.exit(1 if failed else 0)
