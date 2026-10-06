/** A local `.tar.gz` the person can attach to an issue: the doctor report and the (already redacted) crash reports. Nothing is uploaded. */
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function header(name: string, size: number, mtime: number): Buffer {
  const h = Buffer.alloc(512); h.write(name.slice(0, 99), 0, 'utf8'); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116); h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136); h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b; h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148); return h;
}
export function tarGz(files: { name: string; text: string }[], mtime = 0): Buffer {
  const parts: Buffer[] = []; for (const f of files) { const body = Buffer.from(f.text, 'utf8'); parts.push(header(f.name, body.length, mtime), body, Buffer.alloc((512 - (body.length % 512)) % 512)); } parts.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(parts));
}
export function writeBundle(path: string, files: { name: string; text: string }[], mtime = Date.now()): void { writeFileSync(path, tarGz(files, mtime), { mode: 0o600 }); }
