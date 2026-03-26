import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BASE_PATH = '/node-service-console';
const API_PORT = process.env.API_PORT || '3100';

export default defineConfig({
  base: `${BASE_PATH}/`,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      [`${BASE_PATH}/api`]: {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
      // WebSocket 代理（如有需要）
      [`${BASE_PATH}/ws`]: {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        ws: true,
      },
      // WebTerminal WebSocket 代理
      '/terminal/ws': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
