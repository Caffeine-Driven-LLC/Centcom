/** `tsx tools/dev/approve-device.ts <user code> <e-mail>`: approves a device sign-in on the local backend the way a person does (mailed link from Mailpit). Used by pty-collab.py. */
import { approveDevice } from './live-browser.js';
const [code, email] = process.argv.slice(2);
if (!code || !email) { console.error('usage: approve-device.ts <user code> <e-mail>'); process.exit(2); }
await approveDevice(code, email);
console.log('approved');
