import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    // In development the browser app is served here and the API by the server.
    proxy: { '/api': 'http://127.0.0.1:4747' },
  },
});
