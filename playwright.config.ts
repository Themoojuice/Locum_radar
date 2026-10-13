import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    // PLAYWRIGHT_EXECUTABLE points at any Chromium build when no Edge or bundled browser exists.
    ...(process.env.PLAYWRIGHT_EXECUTABLE
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_EXECUTABLE,
            args: (process.env.PLAYWRIGHT_ARGS ?? '').split(' ').filter(Boolean),
          },
        }
      : { channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' }),
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
