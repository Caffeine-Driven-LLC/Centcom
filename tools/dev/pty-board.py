#!/usr/bin/env python3
"""BOARD NOTES ACROSS PEOPLE: runs the REAL `centcom` for two accounts in pseudo-terminals against the local backend (the backend repo's `pnpm dev:up`,
`pnpm dev:api`, `pnpm dev:relay` must be running). Alice shares in branch mode, adds a pinned note, and invites Bob; Bob joins from his own project with
his own agent (the scripted mock Codex of tools/codex, so no model login is needed) and reads her earlier note from the session history in `/board`;
a note Bob adds reaches Alice; the pinned note goes in front of Bob's own agent with his next message; a note Alice (the host) removes is gone from
Bob's board. Every account has a throwaway HOME, so nothing of yours is touched.

    pip install pyte
    python3 tools/dev/pty-board.py

Exit code 0 when every step passed, 3 when this backend cannot do it (no session mode)."""
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

def board_has(term, needle, secs=30):
    """Opens `/board` until the list shows `needle` (notes travel through the relay, so it may take a moment); returns the screen it was seen on."""
    end = time.time() + secs
    while time.time() < end:
        term.line('/board'); term.pump(1.2); s = term.screen(); term.send('\x1b'); term.pump(0.6)
        if needle in s: return s
        term.pump(1.5)
    return None

def board_lacks(term, needle, secs=30):
    end = time.time() + secs
    while time.time() < end:
        term.line('/board'); term.pump(1.2); s = term.screen(); term.send('\x1b'); term.pump(0.6)
        if needle not in s: return True
        term.pump(1.5)
    return False

def main():
    alice_home, bob_home = tempfile.mkdtemp(prefix='centcom-alice-'), tempfile.mkdtemp(prefix='centcom-bob-')
    pa, pb = tempfile.mkdtemp(prefix='centcom-proj-a-'), tempfile.mkdtemp(prefix='centcom-proj-b-')
    for p in (pa, pb): subprocess.run(['git', 'init', '-q', p])
    mock = {'CENTCOM_CODEX_BIN': os.path.join(ROOT, 'tools', 'codex', 'bin', 'codex')}
    terms = []
    try:
        step('Both sign in with the real terminal command')
        a, b = login('alice', alice_home), login('bob', bob_home)
        if not (a and b): return
        step('Alice starts a session where everyone runs their own agent and adds a pinned note BEFORE anybody joins')
        t = Term([BIN, '--engine', 'codex'], alice_home, pa, mock); terms.append(t); t.pump(5); t.send(' '); t.pump(2)
        t.line('/share branch'); m = t.wait(r'(?i)everyone runs their own agent|does not support', 25); check(m is not None, 'alice: /share branch answered')
        if m and 'does not support' in m.group(0):
            print('\nBLOCKED: this backend does not store session modes yet.'); blocked.append(1); return
        t.pump(1); t.line('/note decision: Never touch the db/migrate folder'); t.wait(r'Noted', 8); t.pump(1.5)
        t.line(f'/share invite {b}'); inv = t.wait(r'(https?://[^\s]+/i/[A-Za-z0-9_-]+)', 40); check(inv is not None, 'alice: an invite link for bob was shown')
        if not inv: print(t.screen()); return
        step('Bob joins from his own project with his own agent and reads the earlier note from the history')
        j = Term([BIN, '--engine', 'codex'], bob_home, pb, mock); terms.append(j); j.pump(5); j.send(' '); j.pump(2)
        j.line('/share join ' + inv.group(1)); ok = j.wait(r'(?i)you are in the session with your own agent|Could not join', 40); check(ok is not None and 'in the session' in ok.group(0).lower(), 'bob: joined with his own agent')
        s = board_has(j, 'Never touch the db/migrate', 40); check(s is not None, "bob: /board shows Alice's earlier note")
        if s: check('(host)' in s, 'bob: the note names its author role (host)')
        else: print(j.screen())
        step('A note Bob adds reaches Alice')
        j.line('/note warning: The staging key rotates tonight'); j.wait(r'Noted', 8)
        s = board_has(t, 'staging key rotates', 40); check(s is not None, "alice: /board shows Bob's note")
        if s: check('(editor)' in s, "alice: Bob's note names its author role (editor)")
        step("The pinned note goes in front of Bob's own agent with his next message")
        j.line('say hello from bob'); end = time.time() + 40
        while time.time() < end and 'Hello from mock Codex' not in j.screen(): j.pump(0.5)
        txt = j.text(); check('Hello from mock Codex' in txt, "bob: his own agent answered"); check('note from other agents went along' in txt or 'notes from other agents went along' in txt, "bob: the transcript says Alice's note went along with his message")
        step('The host removes a note: it is gone on the other side')
        t.line('/board'); t.pump(1.5); t.send('\r'); t.pump(1.0)  # the newest entry is Bob's warning: open it
        t.send('\x1b[B'); t.pump(0.3); t.send('\r'); t.pump(2)   # second action: take it off the board
        check(board_lacks(j, 'staging key rotates', 40), "bob: the note the host removed is gone from his board")
        for term in (j, t): term.line('/share stop'); term.pump(2)
    finally:
        for term in terms: term.close()
        for d in (alice_home, bob_home, pa, pb): shutil.rmtree(d, ignore_errors=True)
blocked = []
main()
if blocked: sys.exit(3)
print('\nFAILED: ' + '; '.join(failed) if failed else '\nOK: board notes travel between two real terminals')
sys.exit(1 if failed else 0)
