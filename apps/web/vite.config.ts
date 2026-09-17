import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so `revlens build --static` works from the file system with no
  // server. An absolute base would break the moment the directory is zipped and opened.
  base: './',
  resolve: {
    alias: {
      '@revlens/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    // No external CDN: the material is internal and the static export must work offline.
    assetsInlineLimit: 8192,
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:4173',
    },
  },
});
