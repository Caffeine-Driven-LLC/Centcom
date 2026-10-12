#!/usr/bin/env python3
"""Runs the REAL `centcom` for two accounts in pseudo-terminals against the local backend (the backend repo's `pnpm dev:up`, `pnpm dev:api`,
`pnpm dev:relay` must be running): both sign in with `centcom login`, Alice runs `/share` (the scripted mock Codex of tools/codex answers, so no model login is needed) and invites Bob to the session, Bob runs
`centcom join <link>`, Bob asks for something and Alice runs it. Every account has a throwaway HOME, so nothing of yours is touched.

    pip install pyte      # (only used to print the last screen when a step fails)
    python3 tools/dev/pty-collab.py

Exit code 0 when every step passed."""
import pyte
import os, pty, re, select, shutil, signal, struct, subprocess, sys, tempfile, termios, fcntl, time, secrets

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BIN = os.path.join(ROOT, 'bin', 'centcom')
API = os.environ.get('CENTCOM_API_URL', 'http://localhost:3000')
ANSI = re.compile(rb'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[=>]')
failed = []

def step(text): print(f'\n== {text}', flush=True)
def check(ok, text):
    print(('ok   ' if ok else 'FAIL ') + text, flush=True)
    if not ok: failed.append(text)

class Term:
    def __init__(self, argv, home, cwd, env_extra=None):
        env = dict(os.environ, HOME=home, XDG_CONFIG_HOME=home + '/c', XDG_STATE_HOME=home + '/s', XDG_DATA_HOME=home + '/d', XDG_CACHE_HOME=home + '/k',
                   TERM='xterm-256color', CENTCOM_API_URL=API, CENTCOM_NO_UPDATE_CHECK='1', CENTCOM_KEYCHAIN='file:' + home + '/keychain')
        env.pop('DBUS_SESSION_BUS_ADDRESS', None); env.update(env_extra or {})
        self.raw = b''; self.scr = pyte.Screen(140, 40); self.stream = pyte.ByteStream(self.scr); self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(cwd); os.execvpe(argv[0], argv, env)
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))
    def pump(self, secs=0.5):
        end = time.time() + secs
        while time.time() < end:
            r, _, _ = select.select([self.fd], [], [], 0.05)
            if r:
                try: chunk = os.read(self.fd, 65536); self.raw += chunk; self.stream.feed(chunk)
                except OSError: return False
        return True
    def text(self): return ANSI.sub(b'', self.raw).decode(errors='ignore')
    def screen(self): return '\n'.join(l.rstrip() for l in self.scr.display if l.strip())
    def wait(self, pattern, secs=20):
        end = time.time() + secs
        while time.time() < end:
            self.pump(0.3)
            m = re.search(pattern, self.text())
            if m: return m
        return None
    def send(self, s): os.write(self.fd, s.encode())
    def line(self, s):
        self.send(s); self.pump(0.3); self.send('\r'); self.pump(0.6)
        if '❯ ' + s in self.screen():  # a slash-command menu took the first Enter
            self.send('\r'); self.pump(0.6)
    def close(self):
        try: os.kill(self.pid, signal.SIGTERM)
        except OSError: pass
        try: os.waitpid(self.pid, 0)
        except OSError: pass

def approve(code, email):
    r = subprocess.run(['pnpm', '--silent', 'exec', 'tsx', 'tools/dev/approve-device.ts', code, email], cwd=ROOT, capture_output=True, text=True, timeout=60)
    return r.returncode == 0 and 'approved' in r.stdout

def login(label, home):
    email = f'{label}-{secrets.token_hex(4)}@dev.test'
    t = Term([BIN, 'login', '--no-browser'], home, home)
    m = t.wait(r'Code: ([A-Z0-9]{4}-[A-Z0-9]{4})', 25)
    check(m is not None, f'{label}: `centcom login` printed a code')
    if not m: print(t.text()[-600:]); t.close(); return None
    check(approve(m.group(1), email), f'{label}: the device was approved in the browser as {email}')
    ok = t.wait(r'(?i)signed in|logged in|welcome', 30) is not None
    check(ok, f'{label}: `centcom login` finished'); t.close()
    return email if ok else None

def main():
    alice_home, bob_home = tempfile.mkdtemp(prefix='centcom-alice-'), tempfile.mkdtemp(prefix='centcom-bob-')
    proj = tempfile.mkdtemp(prefix='centcom-proj-'); subprocess.run(['git', 'init', '-q', proj])
    try:
        step('Both sign in with the real terminal command')
        a, b = login('alice', alice_home), login('bob', bob_home)
        if not (a and b): return
        step('Alice runs /share and invites Bob')
        t = Term([BIN, '--engine', 'codex'], alice_home, proj, {'CENTCOM_CODEX_BIN': os.path.join(ROOT, 'tools', 'codex', 'bin', 'codex')}); t.pump(5); t.send(' '); t.pump(2)
        t.line('/share'); m = t.wait(r'(?i)sharing|share', 20); check(m is not None, 'alice: /share answered'); t.pump(2)
        t.line(f'/share invite {b}'); inv = t.wait(r'(https?://[^\s]+/i/[A-Za-z0-9_-]+)', 40); check(inv is not None, 'alice: an invite link was shown')
        if not inv: print(t.screen()); t.close(); return
        link = inv.group(1)
        step('Bob joins with the real terminal command')
        j = Term([BIN, 'join', link], bob_home, proj); ok = j.wait(r'Joined', 40); check(ok is not None, 'bob: `centcom join` joined'); j.pump(3)
        check('In the session' in j.text(), 'bob: sees who is in the session')
        j.line('please list the files'); got = t.wait(r'(?i)bob.*(asks|asked|wants|request)|run it|please list the files', 30); check(got is not None, "alice: Bob's request reached her")
        t.line('/share run 1'); done = j.wait(r'Hello from mock Codex\. You said: please list the files', 40); check(done is not None, "bob: sees the host agent's answer after Alice ran the request")
        if not done: print(j.screen()); print('--- alice'); print(t.screen())
        j.close(); t.line('/share stop'); t.pump(2); t.close()
    finally:
        for d in (alice_home, bob_home, proj): shutil.rmtree(d, ignore_errors=True)
main()
print('\nFAILED: ' + '; '.join(failed) if failed else '\nOK: the signed-in terminal paths work')
sys.exit(1 if failed else 0)
