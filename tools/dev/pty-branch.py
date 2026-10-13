#!/usr/bin/env python3
"""BRANCH MODE: runs the REAL `centcom` for two accounts in pseudo-terminals against the local backend (the backend repo's `pnpm dev:up`, `pnpm dev:api`,
`pnpm dev:relay` must be running): both sign in with `centcom login`, Alice runs `/share branch` in her project and invites Bob; Bob runs `/share join <invite>` in HIS OWN project with his own agent (the scripted mock Codex of tools/codex, so no model login is needed); `/team` on both sides shows both agents; Alice offers Bob her work. Needs a backend that stores the session mode (backend B110): without it the script says BLOCKED and exits 3. Bob runs
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
    pa, pb = tempfile.mkdtemp(prefix='centcom-proj-a-'), tempfile.mkdtemp(prefix='centcom-proj-b-')
    for p in (pa, pb): subprocess.run(['git', 'init', '-q', p])
    mock = {'CENTCOM_CODEX_BIN': os.path.join(ROOT, 'tools', 'codex', 'bin', 'codex')}
    try:
        step('Both sign in with the real terminal command')
        a, b = login('alice', alice_home), login('bob', bob_home)
        if not (a and b): return
        step('Alice starts a session where everyone runs their own agent')
        t = Term([BIN, '--engine', 'codex'], alice_home, pa, mock); t.pump(5); t.send(' '); t.pump(2)
        t.line('/share branch'); m = t.wait(r'(?i)everyone runs their own agent|does not support', 25); check(m is not None, 'alice: /share branch answered')
        if m and 'does not support' in m.group(0):
            print('\nBLOCKED: this backend does not store session modes yet (backend lane B110). The client fell back to a command post, as designed.'); t.close(); blocked.append(1); return
        t.pump(1); inv_cmd = f'/share invite {b}'; t.line(inv_cmd); inv = t.wait(r'(https?://[^\s]+/i/[A-Za-z0-9_-]+)', 40); check(inv is not None, 'alice: an invite link was shown')
        if not inv: print(t.screen()); t.close(); return
        step('Bob joins from his own project with his own agent')
        j = Term([BIN, '--engine', 'codex'], bob_home, pb, mock); j.pump(5); j.send(' '); j.pump(2)
        j.line('/share join ' + inv.group(1)); ok = j.wait(r'(?i)you are in the session with your own agent|command post|Could not join', 40); check(ok is not None and 'in the session' in ok.group(0).lower(), 'bob: joined with his own agent')
        step('Both see both agents')
        for who, term in (('alice', t), ('bob', j)):
            term.line('/team'); end = time.time() + 25
            while time.time() < end and len(re.findall(r': (idle|working)', term.screen())) < 2: term.pump(0.5)
            ok2 = len(re.findall(r': (idle|working)', term.screen())) >= 2; check(ok2, f'{who}: /team lists both agents (his and the other person\'s)')
            if not ok2: print(term.screen())
        step('Alice offers Bob her work')
        t.line('/share handoff 1 finish the tests'); offered = j.wait(r'(?i)offers you|work offered', 6)
        j.line('/team'); got = j.wait(r'(?i)work offered to .*finish the tests', 25); check(got is not None, 'bob: sees the work Alice offered')
        step('Each agent works on its own computer')
        j.line('say hello from bob'); j.wait(r'say hello from bob', 20); end = time.time() + 40
        while time.time() < end and 'Hello from mock Codex. You said: say hello from bob' not in j.screen(): j.pump(0.5)
        done = True if 'Hello from mock Codex. You said: say hello from bob' in j.screen() else None; check(done is not None, "bob's own agent answered on his computer (not Alice's)")
        if not done: print(j.screen())
        t.line('/team'); said = t.wait(r'(?i)bob: say hello from bob|hello from mock', 25); check(said is not None, "alice's /team shows what bob's agent last did")
        for term in (j, t): term.line('/share stop'); term.pump(2); term.close()
    finally:
        for d in (alice_home, bob_home, pa, pb): shutil.rmtree(d, ignore_errors=True)
blocked = []
main()
if blocked: sys.exit(3)
print('\nFAILED: ' + '; '.join(failed) if failed else '\nOK: branch mode works across two real terminals')
sys.exit(1 if failed else 0)
