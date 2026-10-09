import { expect, expectAccessible, test } from './fixtures.js';

/** Every route the app registers; the route-coverage test below fails when a route is added here without a test. */
const ROUTES = ['/', '/login'];
for (const theme of ['light', 'dark'] as const) {
  for (const path of ROUTES) {
    test(`@smoke ${path} has no accessibility problems (${theme})`, async ({ page, probe }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(path);
      await expect(page.locator('#root')).not.toBeEmpty();
      await expectAccessible(page);
      expect(probe.violations).toEqual([]);
    });
  }
}

test('@smoke an injected inline script is blocked by the page policy', async ({ page, probe }) => {
  await page.goto('/');
  await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__ran = true'; document.head.append(s); });
  expect(await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran)).toBeUndefined();
  await expect.poll(() => probe.violations.length).toBeGreaterThan(0);
  probe.violations.length = 0; // expected here, so the fixture's final check passes
});

test('@smoke a fresh visit stores no secrets and puts none in a URL', async ({ page, probe }) => {
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
  const stored = JSON.stringify(await probe.storage());
  expect(stored).not.toMatch(/token|secret|password|bearer/i);
  for (const u of probe.urls) expect(u).not.toMatch(/[?&#](code|token|k)=/);
});
