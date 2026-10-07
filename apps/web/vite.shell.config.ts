import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** The hosted web shell (lane C081). The local app keeps vite.config.ts; this one builds `shell/` into `dist-shell/`. */
export default defineConfig({
  root: resolve(__dirname, 'shell'),
  publicDir: resolve(__dirname, 'shell/public'),
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'shell/src'), '@centcom/theme': resolve(__dirname, '../../packages/theme/src/index.ts'), '@centcom/net': resolve(__dirname, '../../packages/net/src/http/index.ts'), '@centcom/mascot-browser': resolve(__dirname, '../../packages/mascot/src/browser.ts'), '@centcom/fleet': resolve(__dirname, '../../packages/net/src/fleet/model.ts'), '@centcom/states': resolve(__dirname, '../../packages/protocol/src/generated/agent-state.ts'), '@centcom/notify': resolve(__dirname, '../../packages/net/src/notify/browser.ts') } },
  server: { fs: { allow: [resolve(__dirname, '../..')] } },
  build: { outDir: resolve(__dirname, 'dist-shell'), emptyOutDir: true, target: 'es2022', manifest: true, cssCodeSplit: true,
    /* vendor code in its own files keeps the entry small and lets the browser cache it across releases */
    rollupOptions: { output: { manualChunks: (id: string) => (/node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : /@tanstack/.test(id) ? 'router' : /node_modules\/zod/.test(id) ? 'zod' : /packages\/(net|protocol)\//.test(id) ? 'client' : undefined) } } },
});
