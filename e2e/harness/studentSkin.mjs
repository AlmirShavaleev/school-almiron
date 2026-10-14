// Кабинет ученика в стиле лендинга (письмо ЛК_ученика_в_стиле_лендинга.md,
// 14.10.2026): снимки 1280 и 390, светлая и тёмная тема. Данные выдуманы
// (`fixtures.mjs`), Supabase подменён — прод не трогается (board/014).
//
//   VITE_SUPABASE_URL=https://harness.invalid VITE_SUPABASE_ANON_KEY=harness-anon-key npm run dev -- --port 5199 --strictPort
//   node e2e/harness/studentSkin.mjs [папка-для-снимков]
//
// Главная читает RPC `student_home_courses` — в общих фикстурах её нет, здесь
// она своя: курс физики (раздел почти пройден, второй начат) и второй курс,
// чтобы были видны две карточки и «Продолжить урок».
import { chromium } from '@playwright/test'
import path from 'node:path'
import { BASE, makeSession, makeHandler, ensureDir } from './lib.mjs'
import { personas, baseFixtures, IDS } from './fixtures.mjs'

const outDir = ensureDir(path.resolve(process.argv[2] || 'screenshots/harness/student-skin'))
const assetsDir = path.resolve('screenshots/harness/assets')

function fixtures() {
  const fx = baseFixtures('student')
  const t = fx.tables
  const student = t.students.find(s => s.profile_id === IDS.student)
  const math = t.groups.find(g => t.courses.find(c => c.id === g.course_id)?.subject === 'math')
  if (student && math && !t.group_students.some(g => g.group_id === math.id && g.student_id === student.id)) {
    t.group_students.push({ id: 'aa000000-0000-4000-8000-0000000000e1', group_id: math.id, student_id: student.id, joined_at: new Date(Date.now() - 864e5 * 30).toISOString() })
  }
  const physTopic = t.topics.find(tp => tp.course_id === IDS.course) ?? t.topics[0]
  fx.rpc.student_home_courses = t.courses
    .filter(c => ['physics', 'math'].includes(c.subject))
    .map(c => c.subject === 'physics'
      ? {
          course_id: c.id, topics_done: 9, topics_total: 22,
          modules: [
            { module_id: 'm-kin', title: 'Кинематика', done: 6, total: 7 },
            { module_id: 'm-dyn', title: 'Динамика', done: 3, total: 8 },
            { module_id: 'm-zs', title: 'Законы сохранения', done: 0, total: 7 },
          ],
          continue: { topic_id: physTopic.id, title: 'Сила трения покоя', module_title: 'Динамика' },
        }
      : {
          course_id: c.id, topics_done: 4, topics_total: 12,
          modules: [
            { module_id: 'm-alg', title: 'Алгебра', done: 3, total: 6 },
            { module_id: 'm-geo', title: 'Геометрия', done: 1, total: 6 },
          ],
          continue: null,
        })
  return fx
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const p = personas.student
const session = makeSession(p.user)

const SHOTS = [
  { name: 'главная', url: '/student' },
  { name: 'меню', url: '/student', mobileOnly: true, menu: true },
  { name: 'страница-без-перевода', url: '/my-homework', darkOnly: true },
]

for (const width of [1280, 390]) {
  for (const theme of ['light', 'dark']) {
    const mobile = width < 768
    const context = await browser.newContext({
      viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1,
      isMobile: mobile, hasTouch: mobile, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
    })
    await context.addInitScript(({ session, theme }) => {
      try {
        localStorage.setItem('sb-harness-auth-token', JSON.stringify(session))
        localStorage.setItem('almiron:student-theme', theme)
        // Диалог «печатает…» — сразу в конечном виде, чтобы снимок был полным.
        sessionStorage.setItem('almiron:home-chat-seen', '1')
      } catch {}
    }, { session, theme })
    await context.route(u => !u.href.startsWith(BASE), makeHandler({ fixtures: fixtures(), session, assetsDir, log: () => {} }))
    const page = await context.newPage()
    for (const s of SHOTS) {
      if (s.mobileOnly && !mobile) continue
      if (s.darkOnly && theme !== 'dark') continue
      await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(1200)
      // Блоки «при появлении в экране» — прокрутить донизу и обратно.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)) }
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(2200)
      if (s.menu) { await page.click('header button[aria-label="Открыть меню"]'); await page.waitForTimeout(500) }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      const base = path.join(outDir, `лк-${s.name}-${width}-${theme}`)
      await page.screenshot({ path: `${base}.png`, fullPage: !s.menu })
      console.log(`${base}.png${overflow > 0 ? `  ⚠ горизонтальный скролл ${overflow}px` : ''}`)
    }
    await context.close()
  }
}
await browser.close()
