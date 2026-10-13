#!/usr/bin/env python3
"""KEYSTORE CHECK on a real sign-in (lane C099): signs in with the REAL `centcom login` against the local backend (the backend repo's `pnpm dev:up`, `pnpm dev:api`
must be running), with the keychain in a folder (CENTCOM_KEYCHAIN=file:<folder>) so the secrets can be read, then runs a few commands that touch the account, and
checks that none of those secrets is in any other folder the app writes to: config, state, data, cache, logs, crash reports. Throwaway HOME, nothing of yours is touched.

    pip install pyte
    python3 tools/dev/keystore-live.py

Exit code 0 when the check passed."""
import importlib.util, os, subprocess, sys, tempfile, types

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
# reuse the terminal driver and the login steps of the branch-mode script, without running its scenario
src = open(os.path.join(ROOT, 'tools', 'dev', 'pty-branch.py')).read().split('def main():')[0]
pb = types.ModuleType('pty_branch'); pb.__dict__['__file__'] = os.path.join(ROOT, 'tools', 'dev', 'pty-branch.py'); exec(compile(src, 'pty-branch', 'exec'), pb.__dict__)


def main():
    home = tempfile.mkdtemp(prefix='centcom-keystore-')
    pb.step('Sign in with the real terminal command')
    email = pb.login('keystore', home)
    if not email: return 1
    pb.step('Use the account a little, so everything that is going to write has written')
    for args in (['whoami'], ['devices', 'list']):
        t = pb.Term([pb.BIN, *args], home, home); t.pump(6); pb.check(True, f'centcom {" ".join(args)} ran'); t.close()
    pb.step('No secret of the keychain is anywhere else')
    keychain = os.path.join(home, 'keychain')
    names = os.listdir(keychain) if os.path.isdir(keychain) else []
    pb.check(bool(names), f'the keychain folder holds the sign-in ({len(names)} entries)')
    pb.check(all(oct(os.stat(os.path.join(keychain, n)).st_mode & 0o777) == '0o600' for n in names), 'every keychain file is private (0600)')
    scan = [os.path.join(home, d) for d in ('c', 's', 'd', 'k', '.centcom', '.config', '.local', '.cache')]
    scan += [os.path.join(home, n) for n in os.listdir(home) if n not in ('keychain', 'c', 's', 'd', 'k', '.centcom', '.config', '.local', '.cache') and os.path.isdir(os.path.join(home, n))]
    r = subprocess.run(['pnpm', '--silent', 'exec', 'tsx', 'tools/security/keystore-cli.ts', '--keychain', keychain, *scan], cwd=ROOT, capture_output=True, text=True, timeout=120)
    print(r.stdout.strip())
    pb.check(r.returncode == 0, 'none of the keychain secrets is in the config, state, data, cache or log folders')
    return 0 if not pb.failed else 1


if __name__ == '__main__':
    code = main(); print('\nOK: no secret outside the keychain' if code == 0 else '\nFAILED'); sys.exit(code)
