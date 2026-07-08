import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: { port: 5174 },
  // Source unique de la version : package.json. Jamais dupliquée en dur.
  // npm_package_version n'est renseigné que via un script npm (npm run dev /
  // npm run build) — c'est déjà l'usage réel du projet (Vercel appelle
  // "npm run build").
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // #65 — on enregistre le SW nous-mêmes (main.jsx, virtual:pwa-register)
      // pour contrôler onNeedRefresh/onRegisteredSW ; pas d'injection auto.
      injectRegister: false,
      manifest: {
        name: 'PrixMalin',
        short_name: 'PrixMalin',
        description: 'Comparez les prix de vos courses et faites des économies',
        theme_color: '#CC0000',
        background_color: '#F8F8F8',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
})
