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
import { personas, baseFixtures, IDS, LESSON } from './fixtures.mjs'

const outDir = ensureDir(path.resolve(process.argv[2] || 'screenshots/harness/student-skin'))
const assetsDir = path.resolve('screenshots/harness/assets')

function fixtures(scenario) {
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
  // Этап 2: посещения по дням — 12 недель выдуманной активности.
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10)
  const day = (k) => new Date(Date.parse(today) - k * 864e5).toISOString().slice(0, 10)
  const visits = [], solved = []
  for (let k = 0; k < 84; k++) {
    if ((k * 7) % 10 < 6 || k < 4) visits.push(day(k))
    if (k % 3 === 0 && k < 60) solved.push({ day: day(k), n: (k * 5) % 13 })
  }
  fx.rpc.student_home_activity = { today, from: day(83), streak: 4, record: 11, visited_today: true, visits: visits.reverse(), solved: solved.reverse() }

  // Мини-PostgREST фильтрует `module.course_id` по полю строки до переименования
  // связи — даём темам поле `module` (настоящий PostgREST так и отвечает).
  for (const tp of t.topics) if (!tp.module) tp.module = tp.modules
  // Календарь тем. Расписание — план с понедельника 2 недели назад, по 2 темы в неделю.
  const physTopics = t.topics.filter(tp => t.modules?.find(m => m.id === tp.module_id)?.course_id === IDS.course).slice(0, 24)
  const monday = (d) => { const x = new Date(Date.parse(d)); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10) }
  const start = new Date(Date.parse(monday(today)) - 2 * 7 * 864e5).toISOString().slice(0, 10)
  if (scenario === 'schedule') {
    t.course_study_plans = [{ course_id: IDS.course, start_date: start, auto_open: true }]
    t.course_study_plan_items = physTopics.map((tp, i) => ({ course_id: IDS.course, topic_id: tp.id, week_no: Math.floor(i / 2) + 1 }))
    t.course_study_plan_overrides = []
    physTopics.forEach((tp, i) => {
      const ws = new Date(Date.parse(start) + Math.floor(i / 2) * 7 * 864e5).toISOString().slice(0, 10)
      tp.is_open = null; tp.available_from = ws
    })
    fx.rpc.my_course_topic_locks = { mode: 'schedule', topics: [] }
  } else {
    // Пробный период подписки: курс «по прохождению», открыты первые 2 урока.
    fx.rpc.subscription_enabled = true
    t.course_unlock_modes = [{ course_id: IDS.course, mode: 'progress' }]
    // Оплаченная подписка — на «Математику ЕГЭ, профиль» (группа LESSON, её
    // ученик видит в «Моих курсах»); «Песочница» остаётся школьной группой.
    const paid = { id: LESSON.group, course_id: LESSON.course }
    fx.rpc.my_course_demo = (body) => ({ demo: body.p_course_id === IDS.course })
    fx.rpc.my_course_topic_locks = (body) => body.p_course_id === IDS.course
      ? { mode: 'progress', topics: physTopics.slice(0, 12).map((tp, i) => ({
          topic_id: tp.id, title: tp.title, open: i < 2, reason: i < 2 ? 'first2' : null, closed: i === 0,
          percent: null, after_topic_id: null, after_title: i >= 2 ? physTopics[i - 1].title : null, opens_on: null })) }
      : { mode: 'schedule', topics: [] }
    fx.rpc.student_path_home = {
      onboarding: { needed: false, completed: true, grade: 11, exam: 'ege', subject: 'physics', target_score: 85, months_to_exam: 8, hours_per_week: 6, diagnostic_status: 'done' },
      subscriptions: [
        { subscription_id: 'sub-1', course_id: IDS.course, course_title: 'Физика ЕГЭ', group_id: IDS.group, tariff_id: 'tar-1',
          status: 'trial', source: 'trial', demo: true, has_access: true, access_until: new Date(Date.now() + 2 * 864e5).toISOString(), auto_renew: false, continue: null },
        // «Мои курсы»: второй курс — оплаченная подписка (третий — школьная группа).
        ...(paid ? [{ subscription_id: 'sub-2', course_id: paid.course_id, course_title: 'Математика', group_id: paid.id, tariff_id: 'tar-2',
          status: 'active', source: 'purchase', demo: false, has_access: true, access_until: new Date(Date.now() + 33 * 864e5).toISOString(), auto_renew: true, continue: null }] : []),
      ],
    }
  }
  if (scenario === 'empty') {
    const st = t.students.find(s => s.profile_id === IDS.student)
    t.group_students = t.group_students.filter(g => g.student_id !== st?.id)
    fx.rpc.student_home_courses = []
  }
  return fx
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const p = personas.student
const session = makeSession(p.user)

const scenario = ['trial', 'empty'].includes(process.env.SCENARIO) ? process.env.SCENARIO : 'schedule'
const ALL_SHOTS = [
  { name: `главная-${scenario}`, url: '/student' },
  // «Мои курсы» (письмо ЛК_стиль_мои_курсы.md).
  { name: `мои-курсы-${scenario}`, url: '/my-course' },
  // Программа курса: «Календарь тем» — дорожка по разделам (письмо 15.10).
  { name: `курс-${scenario}`, url: `/my-course/${IDS.group}` },
  { name: 'меню', url: '/student', mobileOnly: true, menu: true },
  { name: 'страница-без-перевода', url: '/my-homework', darkOnly: true },
]
// Без курсов — только «Мои курсы» (пустое состояние).
const SHOTS = scenario === 'empty' ? ALL_SHOTS.filter(x => x.url === '/my-course') : ALL_SHOTS

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
    await context.route(u => !u.href.startsWith(BASE), makeHandler({ fixtures: fixtures(scenario), session, assetsDir, log: () => {} }))
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
