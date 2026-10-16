// «Настройки» ученика и цели (письмо ЛК_стиль_настройки_ученика.md, 16.10):
// уведомления (Telegram не привязан / привязан), «Учебные цели», карточка
// «Цели» на главной, цели в карточке ученика и колонка «Цели недели» у
// преподавателя. Снимки 1280 и 390. Данные выдуманы, Supabase подменён —
// прод не трогается (board/014). Функций целей в общих фикстурах нет — здесь.
//
//   VITE_SUPABASE_URL=https://harness.invalid VITE_SUPABASE_ANON_KEY=harness-anon-key npx vite --port 5231 --strictPort
//   HARNESS_PORT=5231 node e2e/harness/settingsGoals.mjs [папка-для-снимков]
import { chromium } from '@playwright/test'
import path from 'node:path'
import { BASE, makeSession, makeHandler, ensureDir } from './lib.mjs'
import { personas, baseFixtures, IDS } from './fixtures.mjs'

const outDir = ensureDir(path.resolve(process.argv[2] || 'screenshots/harness/settings-goals'))
const assetsDir = path.resolve('screenshots/harness/assets')

const WEEKLY = [
  { id: 'g1', kind: 'numbers', subject: 'physics', numbers: [3, 7], topic_ids: [], topic_titles: [], target: 10, progress: 6, done: false },
  { id: 'g2', kind: 'topics', subject: null, numbers: [], topic_ids: ['t'], topic_titles: ['Законы Ньютона'], target: 1, progress: 1, done: true },
  { id: 'g3', kind: 'days', subject: null, numbers: [], topic_ids: [], topic_titles: [], target: 4, progress: 2, done: false },
]

function withGoals(fx) {
  fx.tables.student_exam_goals = [{ profile_id: IDS.student, subject: 'physics', goal: 80, updated_at: new Date().toISOString() }]
  fx.rpc.my_regular_goals = WEEKLY
  fx.rpc.student_goals_for_staff = { exam: [{ subject: 'physics', goal: 80 }], weekly: WEEKLY }
  fx.rpc.course_goals_summary = [
    { student_id: IDS.studentRow, goals: 3, done: 1 },
    ...[0, 1, 2, 3, 4, 5, 6].map(k => ({ student_id: IDS.otherStudent(k), goals: k % 3 === 0 ? 0 : 2, done: k % 2 })),
  ]
  fx.rpc.student_home_courses = [{
    course_id: IDS.course, topics_done: 23, topics_total: 102,
    modules: [{ module_id: IDS.module, title: 'Механика', done: 23, total: 60 }, { module_id: IDS.module2, title: 'МКТ', done: 0, total: 42 }],
    continue: null,
  }]
  return fx
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })

async function open(persona, width, fx, url) {
  const p = personas[persona]
  const session = makeSession(p.user)
  const mobile = width < 768
  const context = await browser.newContext({
    viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile, hasTouch: mobile, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
  })
  await context.addInitScript(({ session, staffProfileId }) => {
    try {
      localStorage.setItem('sb-harness-auth-token', JSON.stringify(session))
      localStorage.setItem('almiron:student-theme', 'light')
      sessionStorage.setItem('almiron:home-chat-seen', '1')
      if (staffProfileId) {
        localStorage.setItem('almiron:staff-mode:' + staffProfileId, 'admin')
        sessionStorage.setItem('almiron:staff-mode-chosen:' + staffProfileId, '1')
      }
    } catch {}
  }, { session, staffProfileId: p.staffProfileId })
  await context.route(u => !u.href.startsWith(BASE), makeHandler({ fixtures: fx, session, assetsDir, log: () => {} }))
  const page = await context.newPage()
  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1800)
  return { context, page }
}

const shot = async (page, name, sel) => {
  const file = path.join(outDir, `${name}.png`)
  if (sel) {
    const el = page.locator(sel).first()
    if (!(await el.count())) { console.log(`нет ${sel} — ${name}`); return }
    await el.scrollIntoViewIfNeeded()
    await el.screenshot({ path: file })
  } else await page.screenshot({ path: file, fullPage: true })
  console.log(file)
}

for (const width of [1280, 390]) {
  // Уведомления: Telegram не привязан (общие фикстуры) и привязан.
  for (const linked of [false, true]) {
    const fx = withGoals(baseFixtures('student'))
    fx.tables.notification_prefs = [{ user_id: IDS.student, telegram: linked, homework: true, checked: true, overdue: true, remind_streak: false }]
    fx.tables.telegram_connections = linked
      ? [{ profile_id: IDS.student, telegram_chat_id: 777, telegram_username: 'anna', is_enabled: true, connected_at: new Date().toISOString(), disconnected_at: null }]
      : []
    const { context, page } = await open('student', width, fx, '/settings?tab=notifications')
    await shot(page, `настройки-уведомления-${linked ? 'tg' : 'без-tg'}-${width}`)
    await context.close()
  }
  // Учебные цели в настройках + форма новой цели.
  {
    const fx = withGoals(baseFixtures('student'))
    const { context, page } = await open('student', width, fx, '/settings?tab=goals')
    await shot(page, `настройки-цели-${width}`)
    const add = page.getByTestId('student-goal-add')
    if (await add.count()) {
      await add.click()
      await page.waitForTimeout(300)
      await shot(page, `настройки-цели-новая-${width}`, '[data-testid="student-weekly-goals"]')
    }
    await context.close()
  }
  // Главная ученика: карточка «Цели».
  {
    const fx = withGoals(baseFixtures('student'))
    const { context, page } = await open('student', width, fx, '/student')
    await shot(page, `главная-цели-${width}`, '[data-testid="home-goals"]')
    await context.close()
  }
  // Преподаватель/владелец: карточка ученика и ученики курса.
  {
    const fx = withGoals(baseFixtures('owner'))
    const { context, page } = await open('owner', width, fx, `/students/${IDS.studentRow}`)
    await shot(page, `карточка-ученика-цели-${width}`, '[data-testid="student-goals-staff"]')
    await shot(page, `карточка-ученика-${width}`)
    await context.close()
  }
  {
    const fx = withGoals(baseFixtures('owner'))
    const { context, page } = await open('owner', width, fx, `/course-program?courseId=${IDS.course}&tab=students`)
    await shot(page, `ученики-курса-цели-${width}`)
    await context.close()
  }
}
await browser.close()
