import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Kiki JLPT Practice',
        short_name: 'JLPT Practice',
        description: 'Local JLPT N5 listening-practice generator',
        theme_color: '#2a2118',
        background_color: '#2a2118',
        display: 'standalone',
        scope: './',
        start_url: './',
        lang: 'en',
        icons: [
          {
            src: 'icon-180.png',
            sizes: '180x180',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'maskable-icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    }),
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
