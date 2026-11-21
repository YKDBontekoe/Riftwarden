import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const port = process.env.RIFT_PORT ?? 8787;

export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  // Co-op: the dev server proxies /ws and /war to the co-op server (pnpm server) so the client always uses same-origin URLs.
  server: { proxy: { '/ws': { target: `ws://localhost:${port}`, ws: true }, '/war': { target: `http://localhost:${port}` } } },
  build: {
    // The server, the Docker image and CI expect the build at the repository root.
    outDir: fileURLToPath(new URL('../../dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 7000,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('@babylonjs') ? 'babylon' : id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
});
