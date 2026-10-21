/**
 * Страница урока у ученика (письмо ЛК_СРОЧНО_страница_урока_перезагружается.md, 19.10):
 * что происходит за N секунд после открытия — запросы к базе (сколько и каких),
 * iframe плеера (сколько), узлы DOM, JS heap (Chromium), повторные загрузки
 * документа. Мобильная эмуляция 390×844, CPU ×4 медленнее.
 *
 *   HARNESS_PORT=5231 node e2e/harness/lessonProbe.mjs [секунд=90]
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { BASE, makeSession, makeHandler } from './lib.mjs'
import { personas, baseFixtures, IDS } from './fixtures.mjs'

const SECONDS = Number(process.argv[2] || 90)
const assetsDir = path.resolve('screenshots/harness/assets')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const session = makeSession(personas.student.user)
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: 'ru-RU', timezoneId: 'Europe/Moscow',
})
// NO_SESSION_STORAGE=1 — sessionStorage бросает (встроенные браузеры приложений, жёсткие настройки).
if (process.env.NO_SESSION_STORAGE) {
  await context.addInitScript(() => {
    const deny = () => { throw new DOMException('denied', 'SecurityError') }
    try { Object.defineProperty(window, 'sessionStorage', { get: deny, configurable: true }) } catch {}
  })
}
await context.addInitScript(({ session }) => {
  try { localStorage.setItem('sb-harness-auth-token', JSON.stringify(session)) } catch {}
}, { session })

const calls = []
const fixtures = baseFixtures('student')
const inner = makeHandler({ fixtures, session, assetsDir, log: (l) => calls.push({ at: Date.now(), l }) })
// Плеер Bunny: пустая страница-заглушка вместо обрыва — iframe живёт, как на проде.
await context.route(u => u.href.includes('mediadelivery.net'), r => r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body style="background:#000"></body></html>' }))
await context.route(u => !u.href.startsWith(BASE) && !u.href.includes('mediadelivery.net'), inner)
// FAIL_CHUNK=TopicPage[:N] — чанк с таким началом имени отвечает 404 (первые N раз; без N — всегда):
// модель «старая вкладка после деплоя» и «сеть оборвала загрузку чанка».
if (process.env.FAIL_CHUNK) {
  const [prefix, times] = process.env.FAIL_CHUNK.split(':')
  let left = times ? Number(times) : Infinity
  await context.route(u => u.href.startsWith(BASE) && new RegExp(`/assets/${prefix}-[^/]+\.js$`).test(u.pathname), r => {
    if (left-- > 0) return r.fulfill({ status: 404, body: '' })
    return r.continue()
  })
}

const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
let docLoads = 0
page.on('domcontentloaded', () => { docLoads++ })

const url = `${BASE}/my-course/${IDS.group}/topic/${IDS.topic(1)}`
const t0 = Date.now()
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
const sample = async () => page.evaluate(() => ({
  iframes: document.querySelectorAll('iframe').length,
  srcs: [...document.querySelectorAll('iframe')].map(f => f.src.replace(/^https?:\/\//, '').slice(0, 70) + ' @' + (f.closest('[data-testid]')?.getAttribute('data-testid') ?? '?')),
  nodes: document.getElementsByTagName('*').length,
  heapMb: (performance).memory ? Math.round((performance).memory.usedJSHeapSize / 1048576) : null,
}))
console.log(`загрузка: ${Date.now() - t0} мс, запросов к базе: ${calls.length}`, await sample())
const firstCount = calls.length
const byName = (list) => {
  const m = new Map()
  for (const c of list) { const k = c.l.replace(/\?.*$/, '').replace(/\s+\d+$/, '').slice(0, 70); m.set(k, (m.get(k) || 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
console.log('первая загрузка — по видам:')
for (const [k, n] of byName(calls).slice(0, 25)) console.log(`  ${String(n).padStart(3)} × ${k}`)

for (let s = 10; s <= SECONDS; s += 10) {
  await page.waitForTimeout(10000)
  console.log(`+${s}s: запросов всего ${calls.length} (+${calls.length - firstCount} после загрузки), перезагрузок документа ${docLoads - 1}`, await sample())
}
console.log('финальный адрес:', new URL(page.url()).pathname + new URL(page.url()).search, '| текст:', (await page.evaluate(() => document.body.innerText)).slice(0, 80).replace(/\s+/g, ' '))
console.log('после загрузки — по видам:')
for (const [k, n] of byName(calls.slice(firstCount)).slice(0, 20)) console.log(`  ${String(n).padStart(3)} × ${k}`)
await browser.close()
