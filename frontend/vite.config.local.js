// Local verification config — proxies /server to `catalyst serve` (localhost:3000)
// instead of the deployed cloud backend. Used by: npx vite --config vite.config.local.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/server': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
})
