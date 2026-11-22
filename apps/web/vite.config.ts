import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    // In development the browser app is served here and the API by the server.
    proxy: { '/api': 'http://127.0.0.1:4747' },
  },
  test: {
    // Component tests render into a simulated DOM; the end-to-end tests in e2e/ drive a real browser with Playwright.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    // The tests are written in the learner's time zone, Europe/Stockholm, and send it with each answer; pinned here, so a machine or CI runner in another zone runs them the same.
    env: { TZ: 'Europe/Stockholm' },
  },
});
