import { defineConfig } from 'vite';

// Backend dev URL; override with VITE_API_URL when the API runs elsewhere.
const apiTarget = process.env.VITE_API_URL || 'http://localhost:5215';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/hubs': { target: apiTarget, changeOrigin: true, ws: true },
      '/health': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
