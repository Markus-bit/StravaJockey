import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // pages: the landing page (/), two guides, the route planner (/app/) and the private stats dashboard (/stats/)
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        howItWorks: resolve(import.meta.dirname, 'how-it-works/index.html'),
        howToUpload: resolve(import.meta.dirname, 'how-to-upload/index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
        stats: resolve(import.meta.dirname, 'stats/index.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true }
    }
  }
})
