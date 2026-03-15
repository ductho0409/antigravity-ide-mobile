import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    preact(), 
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // CRITICAL: Do NOT intercept navigation to /api/* routes.
        // Without this, browser navigation to /api/files/view?path=... returns
        // index.html (SPA fallback) instead of the actual API response.
        navigateFallbackDenylist: [/^\/api\//],
        // Never cache API calls — always go to network
        runtimeCaching: [
          {
            urlPattern: /\/api\/.*/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\/ws.*/,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'Antigravity Control',
        short_name: 'Antigravity',
        description: 'Mobile control panel for Antigravity',
        theme_color: '#050508',
        background_color: '#050508',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3333',
      '/ws': {
        target: 'ws://localhost:3333',
        ws: true,
      },
      '/uploads': 'http://localhost:3333',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
});

