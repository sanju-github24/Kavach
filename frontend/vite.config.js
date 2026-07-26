import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Catalyst Web Client Hosting serves the app under `/app/`, so the production
// build must reference assets from `/app/` (base). Dev/serve stays at `/`.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/app/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/server': {
        target: 'https://ksp-crimint-60073493322.development.catalystserverless.in',
        changeOrigin: true,
        secure: true
      }
    }
  }
}))