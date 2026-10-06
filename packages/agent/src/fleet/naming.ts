import { slug } from '../worktrees/paths.js';

export const BRANCH_RE = /^centcom\/[a-z0-9-]+\/[a-z0-9-]{1,48}-[a-z0-9]{6}$/;
/** The last six characters of an id: unique enough to tell two agents with the same label apart. */
export const id6 = (id: string) => id.slice(-6).toLowerCase();
/** `[a-z0-9-]`, at most 48 characters, never empty. */
export const labelSlug = (label: string, n: number) => slug(label, `agent-${n}`, 48);
