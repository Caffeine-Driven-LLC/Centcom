import { readdir, rm } from 'node:fs/promises';
import { nodeMcpFs } from '../mcp/fs.js';
import type { HooksFs } from './manager.js';

/** Real files: read and atomic write are shared with the MCP manager (an existing file keeps its permissions, a new folder is 0755). */
export const nodeHooksFs: HooksFs = { read: nodeMcpFs.read, writeAtomic: nodeMcpFs.writeAtomic, async list(dir) { try { return await readdir(dir); } catch { return []; } }, remove: (p) => rm(p, { force: true }) };
