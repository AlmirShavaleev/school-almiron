/**
 * Выкатка ЛК без нового лендинга (письмо ЛК_выкатка_без_нового_лендинга.md, 17.10):
 * что видит ГОСТЬ — `/` (как в main: вход), `/about` (прежний лендинг) и скрытый
 * `/preview/landing` (лендинг v3). Сеть наружу не уходит: запросы к базе — пустые
 * ответы (гость, сессии нет).
 *
 *   HARNESS_PORT=5231 node e2e/harness/landingSplit.mjs <папка>
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { BASE, ensureDir } from './lib.mjs'

const outDir = ensureDir(path.resolve(process.argv[2] || 'screenshots/harness/landing-split'))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })

for (const width of [1280, 390]) {
  const mobile = width < 768
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile, hasTouch: mobile, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
  })
  await context.route(u => !u.href.startsWith(BASE), route => route.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))
  const page = await context.newPage()
  for (const [name, url] of [['корень', '/'], ['about', '/about'], ['preview-landing', '/preview/landing']]) {
    await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1500)
    const where = new URL(page.url()).pathname
    const robots = await page.evaluate(() => document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '')
    const file = path.join(outDir, `гость-${name}-${width}.png`)
    await page.screenshot({ path: file })
    console.log(`${file}  → ${where}${robots ? `  robots=${robots}` : ''}`)
  }
  await context.close()
}
await browser.close()
