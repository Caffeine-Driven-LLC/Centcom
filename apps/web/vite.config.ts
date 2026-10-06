import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const p = (s: string) => resolve(__dirname, '../../packages', s);
export default defineConfig({
  root: resolve(__dirname, 'src/client'),
  plugins: [react()],
  resolve: { alias: {
    '@centcom/theme': p('theme/src/index.ts'), '@centcom/mascot': p('mascot/src/browser.ts'),
    '@centcom/models': p('agent/src/models.ts'), '@centcom/commands': p('tui/src/state/commands.ts'),
  } },
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
});
