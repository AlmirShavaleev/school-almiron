/**
 * Видео в уроке у ученика (письмо ЛК_СРОЧНО_видео_на_телефоне_роняет_страницу.md, 27.10):
 * урок с 8 роликами Bunny — сколько iframe плеера до нажатия ▶ (должно быть 0),
 * после нажатия (ровно 1) и после запуска второго ролика (снова 1). Плюс узлы
 * DOM и JS heap (Chromium). Компьютер 1280×800: на телефоне ▶ с 27.10 ведёт на
 * отдельную страницу `/watch/:id` — её проверяет `iphoneWatch.mjs`.
 *
 *   HARNESS_PORT=5231 node e2e/harness/videoFacade.mjs
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { BASE, makeSession, makeHandler } from './lib.mjs'
import { personas, baseFixtures, IDS } from './fixtures.mjs'

const assetsDir = path.resolve('screenshots/harness/assets')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const session = makeSession(personas.student.user)
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: 'ru-RU', timezoneId: 'Europe/Moscow',
})
await context.addInitScript(({ session }) => {
  try { localStorage.setItem('sb-harness-auth-token', JSON.stringify(session)) } catch {}
}, { session })

const fixtures = baseFixtures('student')
// Восемь роликов в «Теории» темы 1 — как в самых тяжёлых уроках на проде.
const tmpl = fixtures.tables.topic_material_items.find(m => m.topic_id === IDS.topic(1) && m.kind === 'video')
const extra = Array.from({ length: 7 }, (_, i) => ({
  ...tmpl,
  id: `00000000-0000-4000-8000-0000000fa${String(i).padStart(3, '0')}`,
  title: `Ролик ${i + 2}`,
  position: 10 + i,
  url: `https://iframe.mediadelivery.net/embed/726880/00000000-0000-4000-8000-0000000fb${String(i).padStart(3, '0')}`,
}))
fixtures.tables.topic_material_items = [...fixtures.tables.topic_material_items, ...extra]

const bunnyHits = []
const inner = makeHandler({ fixtures, session, assetsDir, log: () => {} })
await context.route(u => u.href.includes('mediadelivery.net'), r => {
  bunnyHits.push(r.request().url())
  return r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body style="background:#000"></body></html>' })
})
await context.route(u => !u.href.startsWith(BASE) && !u.href.includes('mediadelivery.net'), inner)

const page = await context.newPage()
await page.goto(`${BASE}/my-course/${IDS.group}/topic/${IDS.topic(1)}`, { waitUntil: 'networkidle', timeout: 60000 })
// Плеер урока — над вкладками; ролики рубрики — во вкладке «Теория».
const theory = page.getByRole('button', { name: /Теория/ }).first()
if (await theory.count()) await theory.click().catch(() => {})
await page.waitForTimeout(1500)

const sample = async (label) => {
  const s = await page.evaluate(() => ({
    facades: document.querySelectorAll('[data-testid="video-facade"]').length,
    bunnyIframes: document.querySelectorAll('iframe[src*="mediadelivery.net"]').length,
    srcs: [...document.querySelectorAll('iframe[src*="mediadelivery.net"]')].map(f => f.src.replace(/^https?:\/\//, '').slice(0, 110)),
    nodes: document.getElementsByTagName('*').length,
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  }))
  console.log(label.padEnd(26), JSON.stringify({ ...s, bunnyRequests: bunnyHits.length }))
  return s
}

const before = await sample('до нажатия')
const facades = page.getByTestId('video-facade')
await facades.nth(0).click()
await page.waitForTimeout(800)
const one = await sample('нажали ▶ первого')
await page.getByTestId('video-facade').nth(Math.min(3, before.facades - 2)).click()
await page.waitForTimeout(800)
const two = await sample('нажали ▶ другого')

const ok = before.bunnyIframes === 0 && one.bunnyIframes === 1 && two.bunnyIframes === 1
console.log(ok ? 'ИТОГ: ок — до нажатия 0 iframe Bunny, дальше всегда ровно 1' : 'ИТОГ: НЕ ОК')
await browser.close()
process.exit(ok ? 0 : 1)
