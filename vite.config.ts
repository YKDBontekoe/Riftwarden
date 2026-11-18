import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
  // Co-op: the dev server proxies /ws to the co-op server (npm run server) so the client always uses same-origin /ws.
  server: { proxy: { '/ws': { target: `ws://localhost:${process.env.RIFT_PORT ?? 8787}`, ws: true } } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 7000,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('@babylonjs') ? 'babylon' : id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
