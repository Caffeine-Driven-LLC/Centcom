/** `@centcom/testkit/vitest`: one Vitest preset for every package. */
import { defineConfig, mergeConfig, type ViteUserConfig as UserConfig } from 'vitest/config'; // vitest 4 names it ViteUserConfig
import { fileURLToPath } from 'node:url';

export const COVERAGE_FLOOR = 80; export const COVERAGE_TARGET = 90;
export function defineCentcomConfig(overrides: UserConfig = {}): UserConfig {
  process.env.TZ = 'UTC'; process.env.LANG ??= 'en_US.UTF-8';
  const base: UserConfig = {
    test: {
      environment: 'node', testTimeout: 10_000, hookTimeout: 10_000, retry: 0, pool: 'forks', setupFiles: [fileURLToPath(new URL('./setup.ts', import.meta.url))],
      env: { TZ: 'UTC', LANG: 'en_US.UTF-8' },
      coverage: { provider: 'v8', reporter: ['text-summary', 'json-summary'], include: ['src/**'], thresholds: { lines: COVERAGE_FLOOR, functions: COVERAGE_FLOOR, branches: COVERAGE_FLOOR, statements: COVERAGE_FLOOR } },
    },
  };
  return mergeConfig(base, defineConfig(overrides));
}
export * from './guards.js';
