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
            // id разделов — те же, что в программе курса (как в настоящей базе).
            { module_id: IDS.module, title: 'Кинематика', done: 6, total: 12 },
            { module_id: IDS.module2, title: 'Динамика', done: 3, total: 10 },
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
    // «Домашние задания» (письмо 15.10): физика — урочный курс, открыты уроки
    // 1–4 (5-й закрыт — его ДЗ на странице нет); ДЗ 3-го урока — автопроверка,
    // решено 2 задачи из 5.
    const hwTopics = t.topic_homework.map(h => h.topic_id)
    for (const tp of t.topics) if (tp.id === hwTopics[0]) tp.lesson_format = 'ege'
    fx.rpc.student_visible_topics = hwTopics.slice(0, 4)
    const ac = t.topic_homework[2]
    if (ac) {
      ac.autocheck = true
      t.topic_autocheck_tasks = Array.from({ length: 5 }, (_, k) => ({ id: `ack-${k}`, topic_id: ac.topic_id, code: String(k + 1), position: k }))
      t.topic_autocheck_answers = [
        { id: 'aca-0', task_id: 'ack-0', profile_id: IDS.student, attempt_no: 1, answer_raw: '1', is_correct: true },
        { id: 'aca-1', task_id: 'ack-1', profile_id: IDS.student, attempt_no: 1, answer_raw: '2', is_correct: true },
      ]
    }
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
  // Прогресс «Б» (письмо ЛК_стиль_мои_курсы_прогресс_Б.md): один курс физики,
  // 6 разделов, 102 темы с ДЗ — «первый день» (day0) и «через месяц» (month).
  // Открытые ДЗ — строки topic_homework с темой и разделом (ученику база
  // отдаёт только открытые; в харнессе RLS нет, поэтому задаём их явно).
  if (scenario === 'day0' || scenario === 'month') {
    const st = t.students.find(s => s.profile_id === IDS.student)
    t.group_students = t.group_students.filter(g => g.student_id !== st?.id || g.group_id === IDS.group)
    const month = scenario === 'month'
    const MODS = [
      ['Математика для физики', 8, month ? 8 : 0, month ? 8 : 8],
      ['Кинематика', 24, month ? 15 : 0, month ? 19 : 6],
      ['Динамика', 22, 0, month ? 2 : 0],
      ['Законы сохранения', 24, 0, 0],
      ['Статика', 12, 0, 0],
      ['Колебания', 12, 0, 0],
    ]
    const done = MODS.reduce((s, m) => s + m[2], 0)
    // Первые два раздела — разделы программы из общих фикстур, остальные
    // добавляем в программу, чтобы плитки и прогресс говорили об одном.
    const modId = (i) => (i === 0 ? IDS.module : i === 1 ? IDS.module2 : `synm-${i}`)
    const physMod = t.modules.find(m => m.id === IDS.module)
    for (let i = 2; i < MODS.length; i++) {
      if (!t.modules.some(m => m.id === modId(i))) t.modules.push({ ...physMod, id: modId(i), title: MODS[i][0], order_index: i + 1, topics: [] })
    }
    fx.rpc.student_home_courses = [{
      course_id: IDS.course, topics_done: done, topics_total: 102,
      modules: MODS.map(([title, total, d], i) => ({ module_id: modId(i), title, done: d, total })),
      continue: { topic_id: physTopic.id, title: month ? 'Свободное падение' : 'Числа, степени, стандартный вид, единицы', module_title: null },
    }]
    t.topic_homework = MODS.flatMap(([, , , open], i) => Array.from({ length: open }, (_, k) => ({
      id: `synhw-${i}-${k}`, topic_id: `synt-${i}-${k}`, is_published: true, topic: { module_id: modId(i) },
    })))
    t.course_unlock_modes = [{ course_id: IDS.course, mode: 'progress' }]
    fx.rpc.subscription_enabled = true
    fx.rpc.student_path_home = {
      onboarding: { needed: false, completed: true, diagnostic_status: 'done' },
      subscriptions: [{ subscription_id: 'sub-1', course_id: IDS.course, course_title: 'Физика ЕГЭ', group_id: IDS.group, tariff_id: 'tar-1',
        status: 'active', source: 'purchase', demo: false, has_access: true, access_until: new Date(Date.now() + 34 * 864e5).toISOString(), auto_renew: true, continue: null }],
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

const scenario = ['trial', 'empty', 'day0', 'month'].includes(process.env.SCENARIO) ? process.env.SCENARIO : 'schedule'
const ALL_SHOTS = [
  { name: `главная-${scenario}`, url: '/student' },
  // «Домашние задания» (письмо ЛК_стиль_раздел_ДЗ_открытые_уроки.md).
  { name: `дз-${scenario}`, url: '/my-homework' },
  // «Мои курсы» (письмо ЛК_стиль_мои_курсы.md).
  { name: `мои-курсы-${scenario}`, url: '/my-course' },
  // Страница курса: шапка, люди, плитки разделов (письмо ЛК_стиль_страница_курса.md).
  { name: `курс-${scenario}`, url: `/my-course/${IDS.group}` },
  // Экран раздела — клик по плитке текущего (или первого) раздела.
  { name: `раздел-${scenario}`, url: `/my-course/${IDS.group}`, section: true },
  { name: 'меню', url: '/student', mobileOnly: true, menu: true },
  { name: 'страница-без-перевода', url: '/my-homework', darkOnly: true },
]
// Без курсов — только «Мои курсы»; подписчик (прогресс «Б») — ещё и страница курса.
const SHOTS = scenario === 'empty' ? ALL_SHOTS.filter(x => x.url === '/my-course')
  : ['day0', 'month'].includes(scenario) ? ALL_SHOTS.filter(x => x.url.startsWith('/my-course'))
  : ALL_SHOTS

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
      if (s.section) {
        const cur = page.locator('[data-testid="module-card"][data-state="current"]')
        const tile = (await cur.count()) > 0 ? cur.first() : page.locator('[data-testid="module-card"]').first()
        await tile.click(); await page.waitForTimeout(1200); await page.evaluate(() => window.scrollTo(0, 0))
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      const base = path.join(outDir, `лк-${s.name}-${width}-${theme}`)
      await page.screenshot({ path: `${base}.png`, fullPage: !s.menu })
      console.log(`${base}.png${overflow > 0 ? `  ⚠ горизонтальный скролл ${overflow}px` : ''}`)
    }
    await context.close()
  }
}
await browser.close()
