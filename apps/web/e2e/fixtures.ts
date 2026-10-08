import { a11yProblems } from './a11y.js';
import { test as base, expect, type Page, type Route } from '@playwright/test';

const MOCK = `http://127.0.0.1:${process.env.E2E_MOCK_PORT ?? 8788}`;
/** The app is built for api.centcom.dev; its requests are answered by the mock backend instead, so nothing leaves the machine. */
async function fulfillFromMock(route: Route, u: URL): Promise<void> {
  try {
    const r = await route.fetch({ url: MOCK + u.pathname + u.search });
    await route.fulfill({ response: r, headers: { ...r.headers(), 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  } catch { await route.abort('connectionrefused'); }
}
/** Hosts the app talks to in production; requests to them never leave the machine. */
const REAL_HOSTS = /(^|\.)centcom\.dev$/;
export interface Probe { violations: string[]; urls: string[]; storage(): Promise<Record<string, string>> }

export const test = base.extend<{ probe: Probe }>({
  probe: async ({ page }, use) => {
    const violations: string[] = []; const urls: string[] = []; const hits: string[] = [];
    await page.exposeFunction('__csp', (m: string) => violations.push(m));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp(m: string): void }).__csp(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber} ${e.sample}`)));
    await page.route('**/*', (route) => {
      const u = new URL(route.request().url()); urls.push(route.request().url());
      if (REAL_HOSTS.test(u.hostname)) { hits.push(route.request().url()); return fulfillFromMock(route, u); }
      return route.continue();
    });
    await use({ violations, urls, storage: () => page.evaluate(() => ({ ...Object.fromEntries(Object.entries(localStorage)), ...Object.fromEntries(Object.entries(sessionStorage)) })) });
    expect(violations, 'CSP violations').toEqual([]);
  },
});
export { expect };

/** No structural accessibility problems on the current page. */
export async function expectAccessible(page: Page): Promise<void> {
  expect((await a11yProblems(page)).map((p) => `${p.rule}: ${p.node}`)).toEqual([]);
}
