/** G1: sign in with the device flow, then read your own profile. Steps: start the device login, wait for approval (the mock approves by itself after two polls; a real
 *  backend needs a person to open the link and approve), call GET /v1/me with the token, check that /v1/me without a token is refused. */
import { b64, createHttpClient, initCrypto, sodium, startDeviceLogin, type HttpClient } from '../../packages/net/src/index.js';
import { GateFailure, type Step } from './gate.js';

export interface G1Context { baseUrl: string; userAgent: string; /** Shown to a person when the backend is real. */ announce?(userCode: string, uri: string): void; interactive: boolean }
interface State { http: HttpClient; token?: string; login?: Awaited<ReturnType<typeof startDeviceLogin>> }

export function g1Steps(): Step<G1Context & { state?: State }>[] {
  return [
    { id: 'device-login-start', async run(c) {
      await initCrypto(); const s = sodium(); const keys = { getOrCreatePublicKeys: async () => ({ x25519: b64(s.crypto_box_keypair().publicKey), ed25519: b64(s.crypto_sign_keypair().publicKey) }) };
      const state: State = { http: createHttpClient({ baseUrl: c.baseUrl, getAccessToken: async () => state.token, userAgent: c.userAgent }) }; c.state = state;
      state.login = await startDeviceLogin({ http: state.http, deviceName: 'centcom gate G1', keys }); if (c.interactive) c.announce?.(state.login.userCode, state.login.verificationUriComplete); return `interval ${state.login.intervalS}s`;
    } },
    { id: 'device-login-approved', async run(c) { const st = c.state!; const t = await st.login!.poll(); if (!t.accessToken) throw new GateFailure('no_token', 'no access token'); st.token = t.accessToken; return 'tokens received'; } },
    { id: 'get-me', async run(c) { const st = c.state!; const me = await st.http.call('getMe', {}); const d = me.data as { user?: { id?: string }; plan?: string }; if (typeof d.user?.id !== 'string' || !d.user.id.startsWith('usr_') || typeof d.plan !== 'string') throw new GateFailure('bad_profile', 'GET /v1/me did not return a user and a plan'); return 'profile read'; } },
    { id: 'get-me-needs-a-token', async run(c) {
      const anon = createHttpClient({ baseUrl: c.baseUrl, getAccessToken: async () => undefined, userAgent: c.userAgent });
      try { await anon.call('getMe', {}); } catch (e) { const st = (e as { status?: number }).status; if (st === 401) return 'refused with 401'; throw e; }
      throw new GateFailure('unauthenticated_me_allowed', 'GET /v1/me answered without a token');
    } },
  ];
}
