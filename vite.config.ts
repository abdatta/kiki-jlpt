import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Studio is intentionally NOT a PWA: it is useless without its live API,
// and an offline-cached shell makes a dead server look like a working app.
// Only the learner Practice build (vite.practice.config.ts) installs a
// service worker.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/audio': 'http://127.0.0.1:8787'
    }
  }
});
