import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so the production build also works when served from
  // the dashboard tile server's /sim/ subpath (the Simulation tab's fallback
  // embed source). The dev server is unaffected.
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/simulation': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/data': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/control': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})

