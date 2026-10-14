import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'npm run start -- --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    env: {
      APP_ORIGIN: 'http://127.0.0.1:3100',
      SQLITE_PATH: `./data/e2e-${Date.now()}.sqlite`,
      APP_PASSWORD: '',
      SESSION_SECRET: '',
    },
    timeout: 120000,
  },
});
