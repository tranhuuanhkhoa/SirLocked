import { defineConfig } from 'vite';
import { caseAssetPackagingPlugin } from './scripts/case-assets.mjs';
import { DEFAULT_API_URL } from './config/apiUrls.js';

// Backend dev URL; override with VITE_API_URL when the API runs elsewhere.
const apiTarget = process.env.VITE_API_URL || DEFAULT_API_URL;
const selectedCaseFiles = JSON.parse(process.env.SIRLOCKED_CASE_FILES || '[]');

export default defineConfig({
  publicDir: selectedCaseFiles.length ? false : 'public',
  plugins: selectedCaseFiles.length ? [caseAssetPackagingPlugin(selectedCaseFiles)] : [],
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
