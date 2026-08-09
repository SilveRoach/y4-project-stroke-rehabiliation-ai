import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const useHttps = process.env.USE_HTTPS === 'true';

export default defineConfig({
  plugins: [
    react(), ...(useHttps ? [basicSsl()] : [])
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: useHttps,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
      },
      '/health': {
        target: 'http://localhost:3000',
      }
    }
  }
});