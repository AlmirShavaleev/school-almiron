// Опрос по уроку и «Качество уроков» (письмо ЛК_стиль_урок_опрос_качества.md,
// 16.10): снимки 1280 и 390. Данные выдуманы (`fixtures.mjs`), Supabase
// подменён — прод не трогается (board/014). Функций опроса в общих фикстурах
// нет — ответы задаём здесь.
//
//   VITE_SUPABASE_URL=https://harness.invalid VITE_SUPABASE_ANON_KEY=harness-anon-key npx vite --port 5231 --strictPort
//   HARNESS_PORT=5231 node e2e/harness/topicFeedback.mjs [папка-для-снимков]
import { chromium } from '@playwright/test'
import path from 'node:path'
import { BASE, makeSession, makeHandler, ensureDir } from './lib.mjs'
import { personas, baseFixtures, IDS } from './fixtures.mjs'

const outDir = ensureDir(path.resolve(process.argv[2] || 'screenshots/harness/topic-feedback'))
const assetsDir = path.resolve('screenshots/harness/assets')

const NAMES = ['Аня Смирнова', 'Петя Иванов', 'Маша Козлова', 'Дима Орлов', 'Катя Белова', 'Саша Ким']
const T = [IDS.topic(21), IDS.topic(22), IDS.topic(23)]
function answers() {
  const at = (h) => new Date(Date.now() - h * 3600e3).toISOString()
  const row = (topic, i, o) => ({
    topic_id: topic, student_id: IDS.otherStudent(i), student_name: NAMES[i % NAMES.length],
    clarity: null, video: null, video_pace: null, lesson_difficulty: null, hw_self: null, hard_spots: [],
    hard_lesson_task: null, hard_hw_task: null, found_error: false, error_where: null, error_task: null, error_text: null,
    time_spent: null, improve: null, updated_at: at(i + 1), ...o,
  })
  return [
    // Вторая тема — проблемная: непонятно, ДЗ сами не решают, задача урока № 4.
    row(T[1], 0, { clarity: 'partly', video: 'partly', video_pace: 'fast', lesson_difficulty: 'hard', hw_self: 'few', hard_spots: ['lesson_task', 'picture'], hard_lesson_task: '4', time_spent: 'gt2h', improve: 'Нужен рисунок к задаче 4 и разбор медленнее' }),
    row(T[1], 1, { clarity: 'no', video: 'full', video_pace: 'fast', lesson_difficulty: 'hard', hw_self: 'none', hard_spots: ['lesson_task', 'theory'], hard_lesson_task: '4', found_error: true, error_where: 'solutions', error_task: '4', error_text: 'В решении потерян минус в проекции', time_spent: '1_2h' }),
    row(T[1], 2, { clarity: 'mostly', video: 'full', video_pace: 'ok', lesson_difficulty: 'hard', hw_self: 'few', hard_spots: ['hw_task'], hard_hw_task: '6', time_spent: '1_2h' }),
    row(T[0], 3, { clarity: 'full', video: 'full', video_pace: 'ok', lesson_difficulty: 'ok', hw_self: 'all', hard_spots: ['nothing'], time_spent: '30_60' }),
    row(T[0], 4, { clarity: 'mostly', video: 'partly', video_pace: 'slow', lesson_difficulty: 'easy', hw_self: 'most', hard_spots: ['examples'], time_spent: 'lt30', improve: 'Больше примеров с числами' }),
    row(T[2], 5, { clarity: 'mostly', video: 'none', lesson_difficulty: 'ok', hw_self: 'most', hard_spots: ['video'], found_error: true, error_where: 'theory', error_text: 'Опечатка в формуле пути: t² вместо t', time_spent: '30_60' }),
  ]
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
      if (staffProfileId) {
        localStorage.setItem('almiron:staff-mode:' + staffProfileId, 'admin')
        sessionStorage.setItem('almiron:staff-mode-chosen:' + staffProfileId, '1')
      }
    } catch {}
  }, { session, staffProfileId: p.staffProfileId })
  await context.route(u => !u.href.startsWith(BASE), makeHandler({ fixtures: fx, session, assetsDir, log: () => {} }))
  const page = await context.newPage()
  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  return { context, page }
}

const shot = async (page, name, sel) => {
  const file = path.join(outDir, `${name}.png`)
  if (sel) {
    const el = page.locator(sel).first()
    await el.scrollIntoViewIfNeeded()
    await el.screenshot({ path: file })
  } else await page.screenshot({ path: file, fullPage: true })
  console.log(file)
}

const lessonUrl = `/my-course/${IDS.group}/topic/${IDS.topic(1)}`
for (const width of [1280, 390]) {
  // Ученик: опрос не пройден — шаг 1, затем шаг 3 с отмеченными ответами.
  {
    const fx = baseFixtures('student')
    fx.rpc.my_topic_feedback = null
    const { context, page } = await open('student', width, fx, lessonUrl)
    await shot(page, `опрос-шаг1-${width}`, '[data-testid="topic-feedback"]')
    await page.locator('[role="group"][aria-label="Понятность"] button', { hasText: 'Частично' }).click()
    await page.getByRole('button', { name: 'Посмотрел целиком' }).click()
    await page.getByRole('button', { name: 'Быстро' }).click()
    await shot(page, `опрос-шаг1-ответы-${width}`, '[data-testid="topic-feedback"]')
    await page.getByTestId('topic-feedback-next').click()
    await page.getByTestId('topic-feedback-next').click()
    await page.getByRole('button', { name: 'Решение задачи урока №' }).click()
    await page.getByRole('button', { name: 'Не хватило рисунка' }).click()
    await page.getByTestId('topic-feedback-lesson-task').fill('4')
    await shot(page, `опрос-шаг3-${width}`, '[data-testid="topic-feedback"]')
    await shot(page, `урок-с-опросом-${width}`)
    await context.close()
  }
  // Ученик: опрос пройден — одна строка.
  {
    const fx = baseFixtures('student')
    fx.rpc.my_topic_feedback = { clarity: 'mostly', hard_spots: [] }
    const { context, page } = await open('student', width, fx, lessonUrl)
    await shot(page, `опрос-пройден-${width}`, '[data-testid="topic-feedback"]')
    await context.close()
  }
  // Владелец: «Качество уроков» по каркасу.
  {
    const fx = baseFixtures('owner')
    fx.rpc.topic_feedback_for_course = answers()
    fx.rpc.topic_ratings_summary = [
      { topic_id: T[0], ratings: 4, avg_rating: 8.5, dist: [0, 0, 0, 0, 0, 0, 0, 2, 1, 1], last_at: new Date().toISOString() },
      { topic_id: T[1], ratings: 5, avg_rating: 4.2, dist: [0, 1, 1, 1, 1, 1, 0, 0, 0, 0], last_at: new Date().toISOString() },
    ]
    const { context, page } = await open('owner', width, fx, `/topic-quality?course=${IDS.courseTemplate}`)
    const first = page.locator('[data-testid="topic-quality-row"] button').first()
    if (await first.count()) { await first.click(); await page.waitForTimeout(300) }
    await shot(page, `качество-уроков-${width}`)
    await context.close()
  }
}
await browser.close()
