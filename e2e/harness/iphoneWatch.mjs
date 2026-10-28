/**
 * iPhone (WebKit, `devices['iPhone 13']`): ▶ в уроке ведёт на отдельную
 * страницу видео, там ровно один iframe Bunny, документ остаётся visible;
 * «← К уроку» возвращает в урок на ту же прокрутку. Письма 27.10
 * ЛК_СРОЧНО_iPhone_видео_всё_ещё_роняет.md и …_отдельная_страница.md.
 * Печатает и важные события RUM, ушедшие в `perf_ingest`.
 *
 *   HARNESS_PORT=5231 node e2e/harness/iphoneWatch.mjs
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
const bunny = []
// Заглушка плеера «как Bunny» (письмо 28.10): объявляет `ready`, на подписку
// `ready` отвечает `ready` снова, считает входящие команды — так виден цикл.
const PLAYER_STUB = `<html><body style="background:#000"><script>
  window.__cmds = 0
  const say = (event, value) => parent.postMessage(JSON.stringify({ context: 'player.js', version: '0.0.11', event, value }), '*')
  addEventListener('message', e => {
    let c; try { c = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return }
    if (!c || c.method !== 'addEventListener') return
    window.__cmds++
    if (c.value === 'ready') say('ready', null)
  })
  setTimeout(() => say('ready', null), 300)
</script></body></html>`
await context.route(u => u.href.includes('mediadelivery.net'), r => {
  bunny.push(r.request().url())
  return r.fulfill({ status: 200, contentType: 'text/html', body: PLAYER_STUB })
})
await context.route(u => !u.href.startsWith(BASE) && !u.href.includes('mediadelivery.net'), inner)
const sent = []
await context.route(u => u.href.includes('/rpc/perf_ingest'), r => {
  const ev = r.request().postDataJSON?.()?.p_events ?? []
  for (const e of ev) if (e.k === 'nav' && /^(play|crash|restore|hide)/.test(e.l)) sent.push(e.l.split(' ')[0])
  return r.fulfill({ status: 200, contentType: 'application/json', body: '1' })
})
let checks = 0, failed = 0
const check = (name, ok, extra = '') => { checks++; if (!ok) failed++; console.log(`${ok ? 'ок ' : 'НЕТ'}  ${name}${extra ? ' — ' + extra : ''}`) }

const page = await context.newPage()
const lesson = `/my-course/${IDS.group}/topic/${IDS.topic(1)}`
await page.goto(BASE + lesson, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(800)
check('в уроке до нажатия iframe Bunny нет', await page.locator('iframe[src*="mediadelivery.net"]').count() === 0)

const facade = page.getByTestId('video-facade').first()
await facade.scrollIntoViewIfNeeded()
await page.mouse.wheel(0, 200).catch(() => {})
await page.evaluate(() => window.scrollBy(0, 150))
const yBefore = await page.evaluate(() => Math.round(window.scrollY))
await facade.tap()
await page.waitForURL(/\/watch\//, { timeout: 10000 }).catch(() => {})
await page.waitForTimeout(1200)
const watch = await page.evaluate(() => ({
  path: location.pathname,
  visibility: document.visibilityState,
  iframes: document.querySelectorAll('iframe').length,
  src: document.querySelector('iframe')?.src ?? '',
  nodes: document.getElementsByTagName('*').length,
}))
check('▶ открыл /watch/:id', watch.path.startsWith('/watch/'), watch.path)
check('на странице видео ровно один iframe', watch.iframes === 1, String(watch.iframes))
check('адрес плеера: autoplay, preload=false, playsinline, disableIosPlayer',
  /autoplay=true/.test(watch.src) && /preload=false/.test(watch.src) && /playsinline=true/.test(watch.src) && /disableIosPlayer=true/.test(watch.src),
  watch.src.replace(/^https?:\/\//, '').slice(0, 140))
check('документ остался visible', watch.visibility === 'visible')
await page.waitForTimeout(3000)
const playerFrame = page.frames().find(f => f.url().includes('mediadelivery.net'))
const cmds = playerFrame ? await playerFrame.evaluate(() => window.__cmds) : -1
check('нет цикла ready ↔ addEventListener: команд плееру за 4 с меньше 30', cmds >= 0 && cmds < 30, String(cmds))
console.log(`     узлов DOM на /watch: ${watch.nodes}`)

await page.getByTestId('watch-back').tap()
await page.waitForURL(u => u.pathname === lesson, { timeout: 10000 }).catch(() => {})
await page.waitForTimeout(1500)
const back = await page.evaluate(() => ({ path: location.pathname, y: Math.round(window.scrollY) }))
check('«← К уроку» вернул в урок', back.path === lesson, back.path)
check('прокрутка урока та же', Math.abs(back.y - yBefore) <= 40, `было ${yBefore}, стало ${back.y}`)
await page.waitForTimeout(500)
check('RUM: play ушёл сразу', sent.includes('play'), JSON.stringify(sent))
check('RUM: play-ready ровно один', sent.filter(x => x === 'play-ready').length === 1, String(sent.filter(x => x === 'play-ready').length))

console.log(failed ? `ИТОГ: НЕ ОК (${failed} из ${checks})` : `ИТОГ: ок (${checks} из ${checks})`)
await browser.close()
process.exit(failed ? 1 : 0)
