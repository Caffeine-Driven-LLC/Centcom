/** The file operations the installer may use. Writes are atomic (temp file, then rename); symbolic links and paths that leave the target are refused. */
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

export class UnsafePath extends Error { readonly code = 'unsafe_path'; constructor(why = 'That path is not safe to write.') { super(why); this.name = 'UnsafePath'; } }
export interface SkillFs { read(path: string): Promise<string | undefined>; writeAtomic(path: string, text: string): Promise<void>; remove(path: string): Promise<void>; /** Throws UnsafePath when `path` (or a folder above it, below `root`) is a symbolic link or leaves `root`. */ assertInside(root: string, path: string): Promise<void> }
export function nodeSkillFs(): SkillFs {
  return {
    async read(p) { try { return await readFile(p, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } },
    async writeAtomic(p, text) { await mkdir(dirname(p), { recursive: true, mode: 0o755 }); const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`; try { await writeFile(tmp, text, { mode: 0o644 }); await rename(tmp, p); } catch (e) { await rm(tmp, { force: true }); throw e; } },
    async remove(p) { await rm(p, { force: true }); },
    async assertInside(root, p) {
      const base = resolve(root); const target = resolve(p); if (target !== base && !target.startsWith(base + sep)) throw new UnsafePath('That path leaves the folder it should stay in.');
      let cur = target; const chain: string[] = []; while (cur.length >= base.length && cur !== dirname(cur)) { chain.push(cur); if (cur === base) break; cur = dirname(cur); }
      for (const c of chain) { try { const st = await lstat(c); if (st.isSymbolicLink()) throw new UnsafePath('A folder on the way is a symbolic link, so nothing was written.'); } catch (e) { if (e instanceof UnsafePath) throw e; if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
      try { const real = await realpath(base); const parent = await realpath(dirname(target)).catch(() => real); if (parent !== real && !parent.startsWith(real + sep)) throw new UnsafePath('That path leaves the folder it should stay in.'); } catch (e) { if (e instanceof UnsafePath) throw e; }
    },
  };
}
