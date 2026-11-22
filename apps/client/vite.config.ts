import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { serviceWorker } from './sw-plugin';

const port = process.env.RIFT_PORT ?? 8787;
// The Rust gateway (accounts, and from step 5 on everything else) in development.
const gateway = process.env.RIFT_GATEWAY ?? 'http://localhost:8090';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), serviceWorker()],
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  // Co-op: the dev server proxies /ws and /war to the co-op server (pnpm server) so the client always uses same-origin URLs.
  server: { proxy: { '/ws': { target: `ws://localhost:${port}`, ws: true }, '/war': { target: gateway }, '/auth': { target: gateway }, '/session': { target: gateway.replace(/^http/, 'ws'), ws: true } } },
  build: {
    // The server, the Docker image and CI expect the build at the repository root.
    outDir: fileURLToPath(new URL('../../dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 7000,
    // No manual chunks: Babylon loads each shader with a dynamic import, which must stay its own chunk.
  },
});
