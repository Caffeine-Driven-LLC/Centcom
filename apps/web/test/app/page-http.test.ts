import { describe, expect, it } from 'vitest';
import { createHttpClient, defaultUserAgent } from '@centcom/net';
import { flatArgs, pageHttp } from '../../src/lib/api.js';

/** The screens pass flat arguments such as `{ id }`; the real client used to throw `path parameter "id" is missing`, so every workspace, billing and integration screen showed an error or an empty list in the hosted app. */
describe('the flat arguments of the screens reach the generated client', () => {
  it('sorts keys into path, query and body by the contract', () => {
    expect(flatArgs('getWorkspace', { id: 'wsp_1' })).toEqual({ path: { id: 'wsp_1' } });
    expect(flatArgs('updateWorkspaceSettings', { id: 'wsp_1', body: { share_history: true } })).toEqual({ body: { share_history: true }, path: { id: 'wsp_1' } });
    expect(flatArgs('listAuditEvents', { id: 'wsp_1', action: 'x', cursor: 'c' })).toEqual({ cursor: 'c', path: { id: 'wsp_1' }, query: { action: 'x' } });
    expect(flatArgs('getWorkspace', { path: { id: 'wsp_2' } })).toEqual({ path: { id: 'wsp_2' } });
    expect(flatArgs('notAnOperation', { id: 1 })).toEqual({ id: 1 });
  });
  it('builds the right address with the real client', async () => {
    const urls: string[] = [];
    const fetch = (async (u: string) => { urls.push(String(u)); return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); }) as unknown as typeof globalThis.fetch;
    const api = createHttpClient({ baseUrl: 'https://api.example.test', getAccessToken: async () => 't', userAgent: defaultUserAgent('web'), fetch } as never);
    await pageHttp(api).call('getWorkspace', { id: 'wsp_1' }).catch(() => undefined);
    await pageHttp(api).listPage('listMembers', { id: 'wsp_1', limit: 5 }).catch(() => undefined);
    expect(urls[0]).toBe('https://api.example.test/v1/workspaces/wsp_1');
    expect(urls[1]).toContain('/v1/workspaces/wsp_1/members?limit=5');
  });
});
