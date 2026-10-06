import { nodeLockFs } from '../../src/locks/fs.js';

// Used by local-registry.test.ts: every child tries to create the same lock file at the same moment; prints who won.
const [, , path, at, name] = process.argv; const wait = Number(at) - Date.now(); await new Promise((r) => setTimeout(r, Math.max(0, wait)));
const won = await nodeLockFs.createExclusive(path!, JSON.stringify({ v: 1, pid: process.pid, agent_id: name, expires_at: new Date(Date.now() + 60_000).toISOString() }));
console.log(won ? `won ${name}` : `lost ${name}`);
