// echoes each line it is typed, prefixed; exits on "quit"
process.stdin.setEncoding('utf8'); let buf = '';
process.stdout.write('ready\r\n');
process.stdin.on('data', (d) => { buf += d; let i; while ((i = buf.search(/[\r\n]/)) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line === 'quit') process.exit(7); if (line) process.stdout.write(`echo: ${line}\r\n`); } });
