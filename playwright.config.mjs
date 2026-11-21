import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 50_000,
  use: { baseURL: 'http://127.0.0.1:4176', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run preview -- --port 4176 --strictPort',
    url: 'http://127.0.0.1:4176',
    timeout: 20_000,
  },
  projects: [
    { name: 'Chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'Edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
});
