import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      // Precache everything the game needs offline: code, WASM, fonts, models, effects and sounds.
      workbox: { globPatterns: ['**/*.{js,css,html,wasm,svg,png,webp,woff2,ttf,glb,mp3}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
      manifest: {
        name: 'Lil Dudes Go Brr',
        short_name: 'Lil Dudes',
        description: '1v1 crowd-cannon duel with hidden gates, on Solana.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1b1530',
        theme_color: '#1b1530',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  server: { host: false },
});
