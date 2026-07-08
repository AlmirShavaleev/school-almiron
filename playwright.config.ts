import { defineConfig, devices } from '@playwright/test'
import path from 'path'

export const AUTH_FILE = path.resolve('test-results/auth.json')

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  retries: 0,
  globalSetup:    './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 900 },
    storageState: AUTH_FILE,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
})
