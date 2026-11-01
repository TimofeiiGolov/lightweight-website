import { defineConfig } from 'vite';

// base './' — сборка работает из любой папки, включая GitHub Pages под-путь
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4096,
    assetsInlineLimit: 8192,
    sourcemap: false
  },
  server: {
    host: true,
    port: 5173
  },
  preview: {
    host: true,
    port: 4173
  }
});
