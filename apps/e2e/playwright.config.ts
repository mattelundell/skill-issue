import { defineConfig, devices } from '@playwright/test';

const PORT = process.env['E2E_PORT'] ?? '4757';
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Browser-driven tests of the application as it ships. They need the
 * workspace built (`pnpm run build`) and the test database running
 * (`docker-compose -f docker-compose.test.yml up -d --wait`).
 */
export default defineConfig({
  testDir: 'tests',
  // The tests share one installation, and the first one needs it empty.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { baseURL, trace: 'retain-on-failure', locale: 'sv-SE' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node serve.ts',
    url: `${baseURL}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
