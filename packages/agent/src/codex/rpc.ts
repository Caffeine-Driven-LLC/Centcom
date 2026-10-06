/** Minimal JSON-RPC 2.0 client for `codex app-server` over stdio. Codex sends and accepts one JSON object per line and omits the "jsonrpc" field. */
import type { ChildProcess } from 'node:child_process';

export interface RpcError { code: number; message: string; data?: unknown }
export type ServerRequestHandler = (id: number | string, method: string, params: any) => void;

export const MAX_RPC_LINE = 1024 * 1024;

export class RpcClient {
  private next = 1;
  private pending = new Map<number | string, { res: (v: any) => void; rej: (e: Error) => void }>();
  private buf = '';
  closed = false;
  onNotification: (method: string, params: any) => void = () => undefined;
  onServerRequest: ServerRequestHandler = () => undefined;
  onClose: (code: number | null) => void = () => undefined;
  /** Called once when a line longer than 1 MiB arrives; the stream cannot be trusted after that. */
  onLineTooLong: () => void = () => undefined;

  constructor(private child: ChildProcess) {
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      this.buf += c; let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) { const raw = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); if (Buffer.byteLength(raw) > MAX_RPC_LINE) { this.overflow(); return; } const line = raw.trim(); if (line) this.handle(line); }
      if (Buffer.byteLength(this.buf) > MAX_RPC_LINE) this.overflow();
    });
    const end = (code: number | null) => { if (this.closed) return; this.closed = true; for (const p of this.pending.values()) p.rej(new Error('codex app-server closed')); this.pending.clear(); this.onClose(code); };
    child.once('close', end); child.once('error', () => end(null));
  }

  private tooLong = false;
  private overflow() { this.buf = ''; if (this.tooLong) return; this.tooLong = true; this.onLineTooLong(); }

  private handle(line: string) {
    let m: any; try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined) && m.method === undefined) {
      const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id);
      if (m.error) p.rej(Object.assign(new Error(m.error.message ?? 'rpc error'), { rpc: m.error as RpcError })); else p.res(m.result);
      return;
    }
    if (m.method && m.id !== undefined) { this.onServerRequest(m.id, m.method, m.params); return; }
    if (m.method) this.onNotification(m.method, m.params);
  }

  private write(o: object) { if (!this.closed) this.child.stdin?.write(JSON.stringify(o) + '\n'); }
  request<T = any>(method: string, params?: object, timeoutMs = 60_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('codex app-server closed'));
    const id = this.next++;
    return new Promise<T>((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`codex ${method} timed out`)); }, timeoutMs); t.unref();
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.write({ id, method, ...(params ? { params } : {}) });
    });
  }
  notify(method: string, params?: object) { this.write({ method, ...(params ? { params } : {}) }); }
  respond(id: number | string, result: object) { this.write({ id, result }); }
  respondError(id: number | string, code: number, message: string) { this.write({ id, error: { code, message } }); }
}
