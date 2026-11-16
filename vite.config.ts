import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: { exclude: ['@babylonjs/havok'] },
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
