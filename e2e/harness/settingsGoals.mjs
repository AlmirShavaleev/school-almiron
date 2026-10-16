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

// Цели недели ставит преподаватель (правка письма 16.10 15:46): 3 стандартные цели.
const GOALS = [
  { kind: 'days', target: 5, progress: 3, done: false },
  { kind: 'topics', target: 3, progress: 3, done: true },
  { kind: 'tasks', target: 20, progress: 12, done: false },
]
const HISTORY = Array.from({ length: 8 }, (_, i) => {
  const d = new Date(Date.now() - (7 - i) * 7 * 864e5)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return { week_start: d.toISOString().slice(0, 10), total: i < 2 ? 0 : 3, done: i < 2 ? 0 : [3, 2, 3, 1, 3, 1][i - 2] }
})

function withGoals(fx) {
  fx.tables.student_exam_goals = [{ profile_id: IDS.student, subject: 'physics', goal: 80, updated_at: new Date().toISOString() }]
  fx.rpc.my_weekly_goals = [{ course_id: IDS.course, course_title: 'Физика ЕГЭ', week_start: HISTORY[7].week_start, goals: GOALS }]
  fx.rpc.course_weekly_goals_get = { days: 5, topics: 3, tasks: 20 }
  fx.rpc.student_goals_for_staff = {
    exam: [{ subject: 'physics', goal: 80 }],
    courses: [{ course_id: IDS.course, course_title: 'Физика ЕГЭ 2027', custom: false,
      course_goals: { days: 5, topics: 3, tasks: 20 }, own_goals: null, goals: GOALS, history: HISTORY }],
  }
  fx.rpc.course_goals_summary = [
    { student_id: IDS.studentRow, goals: 3, done: 1, behind: true },
    ...[0, 1, 2, 3, 4, 5, 6].map(k => ({ student_id: IDS.otherStudent(k), goals: 3, done: k % 4, behind: k % 3 === 0 })),
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
    const edit = page.getByTestId('student-goals-edit')
    if (await edit.count()) {
      await edit.click()
      await page.getByRole('button', { name: 'Своё' }).click()
      await page.waitForTimeout(300)
      await shot(page, `карточка-ученика-своё-${width}`, '[data-testid="student-goals-staff"]')
    }
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
