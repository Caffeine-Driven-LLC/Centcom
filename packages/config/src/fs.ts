/** A tiny filesystem port so everything can be tested without touching disk. */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ConfigFs {
  /** null when the file does not exist; throws on any other error (EACCES etc.) */
  read(path: string): string | null;
  /** Atomic: write a temp file beside the target, then rename over it. */
  writeAtomic(path: string, data: string, mode: number): void;
  isDir(path: string): boolean;
  exists(path: string): boolean;
}

export const nodeFs: ConfigFs = {
  read(path) { try { return readFileSync(path, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return null; throw e; } },
  writeAtomic(path, data, mode) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    try { writeFileSync(tmp, data, { mode }); try { chmodSync(tmp, mode); } catch { /* odd filesystems */ } renameSync(tmp, path); } catch (e) { rmSync(tmp, { force: true }); throw e; }
  },
  isDir(path) { try { return statSync(path).isDirectory(); } catch { return false; } },
  exists(path) { try { statSync(path); return true; } catch { return false; } },
};

/** In-memory filesystem for tests. `failRename` simulates a crash between the temp write and the rename. */
export function memFs(files: Record<string, string> = {}, opts: { unreadable?: string[]; failRename?: boolean } = {}): ConfigFs & { files: Map<string, string>; modes: Map<string, number> } {
  const map = new Map(Object.entries(files)); const modes = new Map<string, number>();
  const dirs = new Set<string>(); for (const p of map.keys()) { let d = dirname(p); while (d !== dirname(d)) { dirs.add(d); d = dirname(d); } }
  return {
    files: map, modes,
    read(p) { if (opts.unreadable?.includes(p)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); return map.get(p) ?? null; },
    writeAtomic(p, d, m) { const tmp = p + '.tmp'; map.set(tmp, d); if (opts.failRename) throw new Error('rename failed'); map.set(p, d); map.delete(tmp); modes.set(p, m); },
    isDir(p) { return dirs.has(p) || [...map.keys()].some((k) => k.startsWith(p + '/')); },
    exists(p) { return map.has(p) || dirs.has(p); },
  };
}
