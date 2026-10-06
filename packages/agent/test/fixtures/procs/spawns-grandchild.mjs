// Starts a grandchild that ignores nothing special, prints "ready <grandchild pid>", and exits on SIGINT while the grandchild would live on unless its group is signalled.
import { spawn } from 'node:child_process';
const g = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' });
process.on('SIGINT', () => process.exit(130));
console.log(`ready ${g.pid}`); setInterval(() => undefined, 1000);
