import react from '@vitejs/plugin-react';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const p = (s: string) => resolve(__dirname, '../../packages', s);
export default defineConfig({
  root: resolve(__dirname, 'src/client'),
  plugins: [react(), { name: 'copy-animations', closeBundle() { copyFileSync(resolve(__dirname, '../../assets/mascot/animations.json'), resolve(__dirname, 'dist/animations.json')); } }],
  resolve: { alias: {
    '@centcom/theme': p('theme/src/index.ts'), '@centcom/mascot': p('mascot/src/browser.ts'),
    '@centcom/models': p('agent/src/models.ts'), '@centcom/commands': p('tui/src/state/commands.ts'),
  } },
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
});
