/**
 * Шторм запросов (письмо ЛК_СРОЧНО_шторм_запросов_программа_курса.md, 27.10):
 * сколько одинаковых GET уходит за минуту работы.
 *  · владелец в режиме учителя: программа курса, раскрыть разделы, 5 раз
 *    переключить тумблер открытости урока (PATCH topics);
 *  · ученик: главная → курс → урок → ДЗ → снова урок.
 * Печатает запросы по таблицам/функциям (топ) — сравнить до/после.
 *
 *   HARNESS_PORT=5231 node e2e/harness/requestStorm.mjs
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { BASE, makeSession, makeHandler } from './lib.mjs'
import { personas, baseFixtures, IDS } from './fixtures.mjs'

const assetsDir = path.resolve('screenshots/harness/assets')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })

async function run(personaKey, fixtureKey, steps) {
  const p = personas[personaKey]
  const session = makeSession(p.user)
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU', timezoneId: 'Europe/Moscow' })
  await context.addInitScript(({ session, staffProfileId, staffMode }) => {
    try {
      localStorage.setItem('sb-harness-auth-token', JSON.stringify(session))
      if (staffProfileId) {
        localStorage.setItem('almiron:staff-mode:' + staffProfileId, staffMode || 'admin')
        sessionStorage.setItem('almiron:staff-mode-chosen:' + staffProfileId, '1')
      }
    } catch {}
  }, { session, staffProfileId: p.staffProfileId ?? null, staffMode: p.staffMode ?? null })
  // Лог харнесса пишет каждую уникальную строку один раз — для счёта нужен
  // каждый запрос, поэтому считаем по событиям контекста.
  const calls = []
  context.on('request', r => {
    const u = new URL(r.url())
    if (!u.hostname.endsWith('harness.invalid')) return
    const m = u.pathname.match(/^\/rest\/v1\/(rpc\/)?([\w-]+)/)
    if (m) calls.push(`${r.method()} ${m[1] ? 'rpc/' : ''}${m[2]}`)
  })
  await context.route(u => !u.href.startsWith(BASE), makeHandler({ fixtures: baseFixtures(fixtureKey), session, assetsDir, log: () => {} }))
  const page = await context.newPage()
  for (const s of steps) await s(page)
  await page.waitForTimeout(1500)
  const m = new Map()
  for (const l of calls) {
    const k = l.replace(/\?.*$/, '').split(' ').slice(0, 2).join(' ')
    m.set(k, (m.get(k) || 0) + 1)
  }
  console.log(`\n== ${personaKey}: всего ${calls.length}`)
  for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${String(n).padStart(4)} × ${k}`)
  await context.close()
}

const go = url => async page => { await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 60000 }); await page.waitForTimeout(800) }

const pressToggles = async page => {
  const toggles = page.locator('[data-testid="topic-row-open-toggle"]')
  const total = await toggles.count()
  const n = Math.min(total, 5)
  for (let i = 0; i < n; i++) { await toggles.nth(i).click().catch(() => {}); await page.waitForTimeout(500) }
  console.log(`тумблеров на вкладке: ${total}, нажато: ${n}`)
}
const clickText = (t) => async page => { await page.getByText(t, { exact: false }).first().click().catch(() => {}); await page.waitForTimeout(1500) }
await run('ownerTeacher', 'owner', [
  go('/course-program'), clickText('Физика ЕГЭ 2027'),
  clickText('Сроки и статистика'), pressToggles,
  clickText('Домашние задания'), pressToggles,
])

await run('student', 'student', [
  go('/student'),
  go(`/my-course/${IDS.group}`),
  go(`/my-course/${IDS.group}/topic/${IDS.topic(1)}`),
  go('/my-homework'),
  go(`/my-course/${IDS.group}/topic/${IDS.topic(2)}`),
])
await browser.close()
