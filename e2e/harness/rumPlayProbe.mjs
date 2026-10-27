/**
 * Что RUM отправляет вокруг нажатия ▶ в уроке (письмо ЛК_СРОЧНО_iPhone_видео_отдельная_страница.md,
 * 27.10: на проде `play` не дошёл ни разу, а `hide`/`crash` доходят). WebKit,
 * iPhone 13. Печатает каждое тело `perf_ingest` с метками `nav`.
 *
 *   HARNESS_PORT=5231 node e2e/harness/rumPlayProbe.mjs
 */
import { webkit, devices } from '@playwright/test'
import path from 'node:path'
import { BASE, makeSession, makeHandler } from './lib.mjs'
import { personas, baseFixtures, IDS } from './fixtures.mjs'

const assetsDir = path.resolve('screenshots/harness/assets')
const browser = await webkit.launch()
const session = makeSession(personas.student.user)
const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU', timezoneId: 'Europe/Moscow' })
await context.addInitScript(({ session }) => {
  try { localStorage.setItem('sb-harness-auth-token', JSON.stringify(session)) } catch {}
}, { session })

const fixtures = baseFixtures('student')
const inner = makeHandler({ fixtures, session, assetsDir, log: () => {} })
await context.route(u => u.href.includes('mediadelivery.net'), r =>
  r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body style="background:#000"></body></html>' }))
await context.route(u => !u.href.startsWith(BASE) && !u.href.includes('mediadelivery.net'), inner)
const t0 = Date.now()
await context.route(u => u.href.includes('/rpc/perf_ingest'), r => {
  const body = r.request().postDataJSON?.() ?? {}
  const ev = Array.isArray(body.p_events) ? body.p_events : []
  const nav = ev.filter(e => e.k === 'nav').map(e => e.l)
  console.log(`+${String(Date.now() - t0).padStart(5)} мс perf_ingest: событий ${ev.length}, nav: ${JSON.stringify(nav)}`)
  return r.fulfill({ status: 200, contentType: 'application/json', body: '1' })
})

const page = await context.newPage()
await page.goto(`${BASE}/my-course/${IDS.group}/topic/${IDS.topic(1)}`, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(1000)
const facade = page.getByTestId('video-facade').first()
console.log('фасадов:', await page.getByTestId('video-facade').count())
await facade.tap()
await page.waitForTimeout(800)
console.log('после ▶:', await page.evaluate(() => ({
  url: location.pathname,
  visibility: document.visibilityState,
  iframes: document.querySelectorAll('iframe[src*="mediadelivery.net"]').length,
  pending: localStorage.getItem('rum:pending'),
})))
// Модель iPhone: после нажатия документ уходит в hidden и процесс умирает.
await page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  document.dispatchEvent(new Event('visibilitychange'))
})
await page.waitForTimeout(800)
await browser.close()
