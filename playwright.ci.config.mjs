import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'python-console.spec.mjs',
  timeout: 80_000,
  retries: 0,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4176', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run preview -- --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176',
    timeout: 30_000,
  },
});
