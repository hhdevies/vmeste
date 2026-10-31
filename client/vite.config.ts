import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const target = process.env.VITE_DEV_SERVER ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // доступно с телефона в локальной сети
    proxy: {
      '/api': target,
      '/socket.io': { target, ws: true },
    },
  },
});
