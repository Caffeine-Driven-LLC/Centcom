import { createHttpClient, defaultUserAgent } from '@centcom/net';
import type { ShellEnv } from './env.js';
/** The API client for the shell. Sign-in (lane C082) supplies the token later; without one only public endpoints work. */
export function makeApi(env: ShellEnv, getAccessToken: () => Promise<string | undefined> = async () => undefined) { return createHttpClient({ baseUrl: env.apiBase, getAccessToken: async () => (await getAccessToken()) ?? '', userAgent: defaultUserAgent('web') }); }
