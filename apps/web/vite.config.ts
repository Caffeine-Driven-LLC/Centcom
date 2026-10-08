import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** The app's screens, built into dist/. The desktop app (apps/desktop) loads them over its own app:// address; paths are relative so they also work from a folder. */
export default defineConfig({
  root: __dirname, base: './',
  publicDir: resolve(__dirname, 'public'),
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src'), '@centcom/theme': resolve(__dirname, '../../packages/theme/src/index.ts'), '@centcom/net': resolve(__dirname, '../../packages/net/src/http/index.ts'), '@centcom/mascot-browser': resolve(__dirname, '../../packages/mascot/src/browser.ts'), '@centcom/fleet': resolve(__dirname, '../../packages/net/src/fleet/model.ts'), '@centcom/states': resolve(__dirname, '../../packages/protocol/src/generated/agent-state.ts'), '@centcom/net-session': resolve(__dirname, '../../packages/net/src/session/index.ts'), '@centcom/net-session-sodium': resolve(__dirname, '../../packages/net/src/crypto/sodium.ts'), '@centcom/net-crypto': resolve(__dirname, '../../packages/net/src/crypto/index.ts'), '@centcom/net-relay-types': resolve(__dirname, '../../packages/net/src/relay/client.ts'), '@centcom/guest': resolve(__dirname, '../../packages/session/src/guest/browser.ts'), 'node:crypto': resolve(__dirname, 'src/session/shim-crypto.ts'), ws: resolve(__dirname, 'src/session/shim-ws.ts'), '@napi-rs/keyring': resolve(__dirname, 'src/session/shim-keyring.ts'), '@centcom/notify': resolve(__dirname, '../../packages/net/src/notify/browser.ts') } },
  server: { fs: { allow: [resolve(__dirname, '../..')] } },
  build: {
    // the page's CSP has no data: for fonts, and small fonts were being inlined as data URIs
    assetsInlineLimit: 0, outDir: resolve(__dirname, 'dist'), emptyOutDir: true, target: 'es2022', manifest: true, cssCodeSplit: true,
    /* vendor code in its own files keeps the entry small and lets the browser cache it across releases */
    rollupOptions: { output: { manualChunks: (id: string) => (/vite\/preload-helper|vite\/modulepreload-polyfill/.test(id) ? 'react' : /node_modules\/(react|react-dom|scheduler)\//.test(id) ? 'react' : /@tanstack/.test(id) ? 'router' : /node_modules\/zod/.test(id) ? 'zod' : /packages\/net\/src\/(session|crypto|delivery|relay)\/|libsodium|buffer\//.test(id) ? 'session-engine' : /packages\/(net|protocol)\//.test(id) ? 'client' : undefined) } } },
});
