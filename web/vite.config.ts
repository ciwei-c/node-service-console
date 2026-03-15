import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BASE_PATH = '/node-service-console';

export default defineConfig({
  base: `${BASE_PATH}/`,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      [`${BASE_PATH}/api`]: {
        target: 'http://localhost:80',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
