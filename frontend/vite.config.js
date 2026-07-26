import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
})