import { defineConfig, devices } from '@playwright/test';

/** Browser tests run against the built app served by `vite preview` and never reach a real Centcom host (see e2e/fixtures.ts). `PW_CHROMIUM` points at an installed Chromium when the bundled revision is missing. */
const port = Number(process.env.E2E_PORT ?? 4173);
const mockPort = Number(process.env.E2E_MOCK_PORT ?? 8788);
const executablePath = process.env.PW_CHROMIUM || undefined;
export default defineConfig({
  testDir: './e2e', timeout: 30_000, expect: { timeout: 5_000 }, fullyParallel: true, forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'on-first-retry', video: 'off', screenshot: 'off', launchOptions: executablePath ? { executablePath } : {} },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: `node --import tsx ../../packages/testkit/bin/mock-backend.ts --data ../../dev/seed --scenario happy --port ${mockPort} --seed 7 --quiet`, url: `http://127.0.0.1:${mockPort}/v1/status`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
    { command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: !process.env.CI, timeout: 60_000 },
  ],
});
