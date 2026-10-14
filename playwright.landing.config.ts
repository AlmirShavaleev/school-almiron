import { defineConfig, devices } from '@playwright/test'

/**
 * E2E лендинга — отдельно от основного конфига: тому нужны вход демо-учётками
 * (global-setup), а лендинг открывает гость. Никаких учёток здесь нет.
 *
 *   npx playwright test -c playwright.landing.config.ts
 *
 * Скриншоты (светлая/тёмная, 1280 и 390) — тем же прогоном, если задан
 * LANDING_SHOTS_DIR.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /landing\.spec\.ts/,
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: true,
    timeout: 180_000,
  },
})
