import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'index.practice.html')
    }
  },
  define: {
    'import.meta.env.VITE_PRACTICE_ONLY': JSON.stringify('true')
  },
  plugins: [
    react(),
    {
      name: 'practice-index-output',
      async closeBundle() {
        const distDir = path.resolve(import.meta.dirname, 'dist');
        await rm(path.join(distDir, 'index.html'), { force: true });
        await rename(path.join(distDir, 'index.practice.html'), path.join(distDir, 'index.html'));
      }
    }
  ]
});
