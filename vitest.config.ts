import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      '@centcom/theme': r('./packages/theme/src/index.ts'),
      '@centcom/mascot': r('./packages/mascot/src/index.ts'),
      '@centcom/agent': r('./packages/agent/src/index.ts'),
      '@centcom/skills': r('./packages/skills/src/index.ts'),
      '@centcom/config': r('./packages/config/src/index.ts'),
      '@centcom/protocol': r('./packages/protocol/src/index.ts'),
      '@centcom/net': r('./packages/net/src/index.ts'),
      '@centcom/lan': r('./packages/lan/src/index.ts'),
      '@centcom/testkit': r('./packages/testkit/src/index.ts'),
      '@centcom/tui': r('./packages/tui/src/index.ts'),
    },
  },
  test: { include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx', 'apps/*/test/**/*.test.ts', 'tools/**/*.test.ts'], environment: 'node' },
});
