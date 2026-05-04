import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Kiki JLPT Studio',
        short_name: 'Kiki JLPT Studio',
        description: 'Local JLPT N5 listening-practice generator with review and Gemini TTS.',
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
    })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/audio': 'http://127.0.0.1:8787'
    }
  }
});
