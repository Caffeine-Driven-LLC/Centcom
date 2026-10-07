import { describe, expect, it } from 'vitest';
import { readConnectivity } from '../../src/lib/connectivity.js';
import { parseEnv } from '../../src/lib/env.js';

describe('env', () => {
  it('defaults, trims a trailing slash, and falls back with a report on bad values', () => {
    expect(parseEnv({})).toEqual({ env: { apiBase: 'https://api.centcom.dev', relayBase: 'wss://relay.centcom.dev' }, problems: [] }); expect(parseEnv({ VITE_API_BASE: 'http://localhost:4010/', VITE_RELAY_BASE: 'ws://localhost:4011' }).env).toEqual({ apiBase: 'http://localhost:4010', relayBase: 'ws://localhost:4011' });
    const bad = parseEnv({ VITE_API_BASE: 'not a url', VITE_RELAY_BASE: 'https://x' }); expect(bad.env.apiBase).toBe('https://api.centcom.dev'); expect(bad.problems).toHaveLength(2);
  });
});
describe('connectivity from GET /v1/status', () => {
  it('maps operational, anything else and a failure', async () => { expect(await readConnectivity({ getStatus: async () => ({ status: 'operational' }) })).toBe('online'); expect(await readConnectivity({ getStatus: async () => ({ status: 'degraded' }) })).toBe('degraded'); expect(await readConnectivity({ getStatus: async () => { throw new Error('x'); } })).toBe('offline'); const ac = new AbortController(); ac.abort(); expect(await readConnectivity({ getStatus: async () => { throw new Error('x'); } }, ac.signal)).toBe('unknown'); });
});
