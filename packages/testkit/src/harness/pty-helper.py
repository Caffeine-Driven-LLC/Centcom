#!/usr/bin/env python3
"""Runs a command on a real pseudo terminal and relays bytes (stdlib only, no native module).
usage: pty-helper.py COLS ROWS -- CMD [ARGS...]
stdin -> terminal input, terminal output -> stdout, fd 3 reads control lines: "resize COLS ROWS", "kill".
Exit status: the command's exit code, or 128 + the signal that ended it."""
import fcntl, os, pty, select, signal, struct, sys, termios

def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

def main():
    cols, rows = int(sys.argv[1]), int(sys.argv[2])
    cmd = sys.argv[4:]
    pid, fd = pty.fork()
    if pid == 0:
        set_size(0, cols, rows)
        try:
            os.execvp(cmd[0], cmd)
        except OSError as e:
            sys.stderr.write("cannot run %s: %s\n" % (cmd[0], e.strerror))
            os._exit(127)
    set_size(fd, cols, rows)
    ctl = 3 if hasattr(os, "fstat") and _fd_open(3) else None
    buf = b""
    inputs = [fd, 0] + ([ctl] if ctl is not None else [])
    stdin_open = True
    while True:
        try:
            r, _, _ = select.select(inputs, [], [])
        except InterruptedError:
            continue
        if fd in r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                data = b""
            if not data:
                break
            os.write(1, data)
        if 0 in r and stdin_open:
            data = os.read(0, 65536)
            if not data:
                stdin_open = False
                inputs.remove(0)
            else:
                os.write(fd, data)
        if ctl is not None and ctl in r:
            data = os.read(ctl, 4096)
            if not data:
                inputs.remove(ctl)
                ctl = None
            else:
                buf += data
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    parts = line.decode().split()
                    if parts[:1] == ["resize"] and len(parts) == 3:
                        set_size(fd, int(parts[1]), int(parts[2]))
                    elif parts[:1] == ["kill"]:
                        try:
                            os.killpg(os.getpgid(pid), signal.SIGKILL)
                        except OSError:
                            os.kill(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
    sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status))

def _fd_open(n):
    try:
        os.fstat(n)
        return True
    except OSError:
        return False

main()
