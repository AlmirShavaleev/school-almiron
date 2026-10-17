// Модалка «Урок пройден / открыт следующий» (письмо ЛК_стиль_модалка_открыт_урок.md,
// 16.10) — четыре ситуации, 1280 и 390; плюс плитка закрытого урока с подсказкой
// (письмо ЛК_стиль_открытие_урока_в_плитке.md). Данные выдуманы, Supabase
// подменён — прод не трогается (board/014). «Прошлый снимок» кладём в
// localStorage до загрузки, событие — разница с ним (как у ученика).
//
//   VITE_SUPABASE_URL=https://harness.invalid VITE_SUPABASE_ANON_KEY=harness-anon-key npx vite --port 5231 --strictPort
//   HARNESS_PORT=5231 node e2e/harness/lessonEvents.mjs [папка-для-снимков]
import { chromium } from '@playwright/test'
import path from 'node:path'
import { BASE, makeSession, makeHandler, ensureDir } from './lib.mjs'
import { personas, baseFixtures, IDS } from './fixtures.mjs'

const outDir = ensureDir(path.resolve(process.argv[2] || 'screenshots/harness/lesson-events'))
const assetsDir = path.resolve('screenshots/harness/assets')
// Сцены меняют строки фикстур — каждой свои копии таблиц, иначе правки протекают в следующую.
function fresh() { const fx = baseFixtures('student'); fx.tables = structuredClone(fx.tables); return fx }
const day = (k) => new Date(Date.now() + 3 * 3600e3 + k * 864e5).toISOString().slice(0, 10)

function patchTopic(fx, id, patch) {
  for (const t of fx.tables.topics) if (t.id === id) Object.assign(t, patch)
  for (const m of fx.tables.modules) for (const t of m.topics ?? []) if (t.id === id) Object.assign(t, patch)
}

function setHw(fx, n, status) {
  const rows = fx.tables.topic_homework_attempts
  const mine = rows.find(a => a.homework_id === IDS.hw(n) && a.student_id === IDS.studentRow)
  if (mine) { mine.status = status; return }
  const tpl = rows.find(a => a.student_id === IDS.studentRow)
  rows.push({ ...tpl, id: `aa${n}0000-0000-4000-8000-00000000ab0${n}`, homework_id: IDS.hw(n), status, attempt_number: 1, topic_homework_reviews: [] })
}

/** Прошлый снимок: засчитано — как сейчас минус doneOff; открыто — все темы курса минус openOff. */
function prevSnapshot(fx, doneOff = [], openOff = []) {
  const doneHw = fx.tables.topic_homework_attempts
    .filter(a => a.student_id === IDS.studentRow && ['submitted', 'accepted'].includes(a.status))
    .map(a => fx.tables.topic_homework.find(h => h.id === a.homework_id)?.topic_id)
    .filter(Boolean)
  const courseTopics = fx.tables.topics.filter(t => fx.tables.modules.find(m => m.id === t.module_id)?.course_id === IDS.course).map(t => t.id)
  return { done: doneHw.filter(id => !doneOff.includes(id)), open: courseTopics.filter(id => !openOff.includes(id)) }
}

const SCENES = {
  // 1. Сдан урок 3 → следующий урок 4 открыт.
  next: (fx) => prevSnapshot(fx, [IDS.topic(3)]),
  // 2. Все открытые уроки раздела сданы, следующие — по дате.
  wait: (fx) => {
    for (const n of [1, 4]) setHw(fx, n, 'submitted')
    for (const n of [5, 6, 9]) patchTopic(fx, IDS.topic(n), { is_open: null, available_from: day(3) })
    return prevSnapshot(fx, [IDS.topic(4)])
  },
  // 3. Открылись новые уроки (первый вход после даты).
  opened: (fx) => {
    patchTopic(fx, IDS.topic(6), { is_open: null, available_from: day(10) })
    return prevSnapshot(fx, [], [IDS.topic(4), IDS.topic(5), IDS.topic(9)])
  },
  // 4. Раздел пройден.
  section: (fx) => {
    for (const n of [1, 4, 5]) setHw(fx, n, 'accepted')
    for (const n of [6, 9]) patchTopic(fx, IDS.topic(n), { is_open: true })
    return prevSnapshot(fx, [IDS.topic(5)])
  },
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const p = personas.student
const session = makeSession(p.user)

for (const width of [1280, 390]) {
  const mobile = width < 768
  for (const [name, setup] of Object.entries(SCENES)) {
    const fx = fresh()
    const snap = setup(fx)
    const context = await browser.newContext({
      viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile, hasTouch: mobile, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
    })
    await context.addInitScript(({ session, key, snap }) => {
      try {
        localStorage.setItem('sb-harness-auth-token', JSON.stringify(session))
        localStorage.setItem('almiron:student-theme', 'light')
        if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, JSON.stringify(snap)); sessionStorage.setItem('seeded', '1') }
      } catch {}
    }, { session, key: `lesson-events:${IDS.student}:${IDS.course}`, snap })
    await context.route(u => !u.href.startsWith(BASE), makeHandler({ fixtures: fx, session, assetsDir, log: () => {} }))
    const page = await context.newPage()
    await page.goto(`${BASE}/my-course/${IDS.group}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1800)
    const file = path.join(outDir, `модалка-${name}-${width}.png`)
    const has = await page.locator('[data-testid="lesson-event"]').count()
    await page.screenshot({ path: file })
    console.log(file, has ? '' : '⚠ модалки нет')
    await context.close()
  }

  // Плитка закрытого урока: подсказка по нажатию.
  {
    const fx = fresh()
    patchTopic(fx, IDS.topic(6), { is_open: null, available_from: day(3) })
    patchTopic(fx, IDS.topic(9), { is_open: null, available_from: day(10) })
    const context = await browser.newContext({
      viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile, hasTouch: mobile, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
    })
    await context.addInitScript(({ session, key, snap }) => {
      try {
        localStorage.setItem('sb-harness-auth-token', JSON.stringify(session))
        localStorage.setItem('almiron:student-theme', 'light')
        localStorage.setItem(key, JSON.stringify(snap))
      } catch {}
    }, { session, key: `lesson-events:${IDS.student}:${IDS.course}`, snap: prevSnapshot(fx) })
    await context.route(u => !u.href.startsWith(BASE), makeHandler({ fixtures: fx, session, assetsDir, log: () => {} }))
    const page = await context.newPage()
    await page.goto(`${BASE}/my-course/${IDS.group}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1500)
    await page.locator('[data-testid="module-card"]').first().click()
    await page.waitForTimeout(800)
    const locked = page.locator('[data-testid="lesson-tile"][data-state="locked"] button').first()
    if (await locked.count()) { await locked.click(); await page.waitForTimeout(300) }
    const file = path.join(outDir, `раздел-плитки-подсказка-${width}.png`)
    await page.screenshot({ path: file, fullPage: true })
    console.log(file)
    await context.close()
  }
}
await browser.close()
