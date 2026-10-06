/** A small in-memory file system with the calls other lanes inject (`FsLike`). Paths are POSIX style; folders are made on write. */
export interface FsLike {
  readFile(path: string): Promise<Uint8Array>; readText(path: string): Promise<string>; writeFile(path: string, data: string | Uint8Array, o?: { mode?: number }): Promise<void>;
  appendFile(path: string, data: string): Promise<void>; mkdir(path: string, o?: { recursive?: boolean }): Promise<void>; readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<{ size: number; isFile: boolean; isDirectory: boolean; mode: number }>; rename(from: string, to: string): Promise<void>; rm(path: string, o?: { recursive?: boolean; force?: boolean }): Promise<void>; exists(path: string): Promise<boolean>;
}
const norm = (p: string): string => { const out: string[] = []; for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); } return '/' + out.join('/'); };
const enoent = (p: string, op: string) => Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), { code: 'ENOENT' });
export function memFs(seed: Record<string, string> = {}): FsLike & { files(): Record<string, string> } {
  const files = new Map<string, { data: Uint8Array; mode: number }>(); const dirs = new Set<string>(['/']); const enc = new TextEncoder(); const dec = new TextDecoder();
  const parents = (p: string) => { let d = p; while ((d = d.slice(0, d.lastIndexOf('/')) || '/') && d !== '/') dirs.add(d); };
  for (const [p, t] of Object.entries(seed)) { files.set(norm(p), { data: enc.encode(t), mode: 0o644 }); parents(norm(p)); }
  const fs: FsLike & { files(): Record<string, string> } = {
    async readFile(p) { const f = files.get(norm(p)); if (!f) throw enoent(p, 'open'); return f.data.slice(); }, async readText(p) { return dec.decode(await fs.readFile(p)); },
    async writeFile(p, data, o) { const n = norm(p); if (dirs.has(n)) throw Object.assign(new Error(`EISDIR: ${p}`), { code: 'EISDIR' }); files.set(n, { data: typeof data === 'string' ? enc.encode(data) : data.slice(), mode: o?.mode ?? 0o644 }); parents(n); },
    async appendFile(p, data) { const n = norm(p); const cur = files.get(n)?.data ?? new Uint8Array(); const add = enc.encode(data); const out = new Uint8Array(cur.length + add.length); out.set(cur); out.set(add, cur.length); files.set(n, { data: out, mode: files.get(n)?.mode ?? 0o644 }); parents(n); },
    async mkdir(p, o) { const n = norm(p); if (!o?.recursive && !dirs.has(n.slice(0, n.lastIndexOf('/')) || '/')) throw enoent(p, 'mkdir'); dirs.add(n); parents(n); },
    async readdir(p) { const n = norm(p); if (!dirs.has(n)) throw enoent(p, 'scandir'); const pre = n === '/' ? '/' : n + '/'; const out = new Set<string>(); for (const k of [...files.keys(), ...dirs]) if (k !== n && k.startsWith(pre)) out.add(k.slice(pre.length).split('/')[0]!); return [...out].sort(); },
    async stat(p) { const n = norm(p); const f = files.get(n); if (f) return { size: f.data.length, isFile: true, isDirectory: false, mode: f.mode }; if (dirs.has(n)) return { size: 0, isFile: false, isDirectory: true, mode: 0o755 }; throw enoent(p, 'stat'); },
    async rename(a, b) { const x = norm(a); const y = norm(b); const f = files.get(x); if (!f) throw enoent(a, 'rename'); files.delete(x); files.set(y, f); parents(y); },
    async rm(p, o) { const n = norm(p); if (files.delete(n)) return; if (dirs.has(n)) { if (!o?.recursive) throw Object.assign(new Error(`EISDIR: ${p}`), { code: 'EISDIR' }); for (const k of [...files.keys()]) if (k.startsWith(n + '/')) files.delete(k); for (const k of [...dirs]) if (k === n || k.startsWith(n + '/')) dirs.delete(k); return; } if (!o?.force) throw enoent(p, 'rm'); },
    async exists(p) { const n = norm(p); return files.has(n) || dirs.has(n); },
    files() { return Object.fromEntries([...files].map(([k, v]) => [k, dec.decode(v.data)])); },
  };
  return fs;
}
