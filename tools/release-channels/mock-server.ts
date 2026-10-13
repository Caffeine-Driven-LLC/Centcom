/** A local release server for `GET /v1/releases/{channel}/latest?platform=&arch=`, `/v1/status` and the artifact files, with switchable faults for the attacks the update
 *  client must survive: a changed byte, a wrong or unknown signing key, a replayed old release, a manifest for the wrong channel, a slow network and the 426 "too old"
 *  answer. It listens on loopback only. It stands in for the real hosting, which does not exist yet. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type ApiPlatform, type Arch, type Channel, type ReleaseChannels } from './channels.js';

export type Fault = 'none' | 'tamper' | 'bad_signature' | 'unknown_kid' | 'replay_old' | 'wrong_channel' | 'too_old_426' | 'server_error' | 'truncate';
export interface MockReleaseServerOptions { channels: ReleaseChannels; fault?: () => Fault; latencyMs?: number; minClientVersion?: string }
export interface MockReleaseServer { url: string; requests: { method: string; path: string }[]; close(): Promise<void> }

const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json'): void => { const b = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body); res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(b) }); res.end(b); };
const flip = (b: Buffer): Buffer => { const c = Buffer.from(b); c[Math.floor(c.length / 2)] = (c[Math.floor(c.length / 2)]! ^ 0xff) & 0xff; return c; };

export function startMockReleaseServer(o: MockReleaseServerOptions): Promise<MockReleaseServer> {
  const requests: MockReleaseServer['requests'] = []; let base = '';
  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1'); requests.push({ method: req.method ?? 'GET', path: u.pathname }); const fault = o.fault?.() ?? 'none';
    if (fault === 'server_error') return send(res, 503, { type: 'https://centcom.dev/errors/service_unavailable', title: 'Unavailable', status: 503, code: 'service_unavailable' }, 'application/problem+json');
    if (fault === 'too_old_426') return send(res, 426, { type: 'https://centcom.dev/errors/client_too_old', title: 'Client too old', status: 426, code: 'client_too_old' }, 'application/problem+json');
    if (u.pathname === '/v1/status') return send(res, 200, { status: 'ok', ...(o.minClientVersion ? { min_client_version: o.minClientVersion } : {}) });
    const m = /^\/v1\/releases\/(stable|beta|nightly)\/latest$/.exec(u.pathname);
    if (m) {
      const channel = m[1] as Channel; const platform = u.searchParams.get('platform') as ApiPlatform; const arch = u.searchParams.get('arch') as Arch;
      const all = o.channels.all(channel); let rel = o.channels.latest(channel); if (fault === 'replay_old' && all.length > 1) rel = all[0];
      if (!rel) return send(res, 404, { type: 'https://centcom.dev/errors/not_found', title: 'No release', status: 404, code: 'not_found' }, 'application/problem+json');
      const man = o.channels.manifest(rel, platform, arch, base); const a = man.artifacts[0];
      if (a && fault === 'bad_signature') a.signature = a.signature.slice(0, -4) + (a.signature.endsWith('AAAA') ? 'BBBB' : 'AAAA');
      if (a && fault === 'unknown_kid') a.sig_kid = 'rel-unknown';
      if (fault === 'wrong_channel') man.channel = channel === 'stable' ? 'nightly' : 'stable';
      return send(res, 200, man);
    }
    const f = /^\/artifacts\/(stable|beta|nightly)\/([^/]+)\/(linux|macos|windows)-(x64|arm64)$/.exec(u.pathname);
    if (f) {
      const body = o.channels.file(f[1] as Channel, f[2]!, f[3] as ApiPlatform, f[4] as Arch); if (!body) return send(res, 404, 'not found', 'text/plain');
      const out = fault === 'tamper' ? flip(body) : body;
      if (fault === 'truncate') { res.writeHead(200, { 'content-length': out.length }); res.write(out.subarray(0, Math.floor(out.length / 2))); setTimeout(() => res.destroy(), 10); return; }
      return send(res, 200, out, 'application/octet-stream');
    }
    send(res, 404, 'not found', 'text/plain');
  };
  const srv = createServer((req, res) => { if (o.latencyMs) setTimeout(() => handle(req, res), o.latencyMs); else handle(req, res); });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`; resolve({ url: base, requests, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); }) }); }));
}
