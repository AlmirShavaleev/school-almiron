import { chromium, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BASE, SB, ensureDir, makeHandler, makeSession, newPage } from './lib.mjs'
import { baseFixtures, IDS, personas } from './fixtures.mjs'

const cloudOrigin = new URL(readFileSync('src/lib/cloudProject.ts', 'utf8').match(/https:\/\/[\w.-]+\.supabase\.co/)[0]).origin
const baseOrigin = new URL(BASE).origin
const output = ensureDir(path.resolve('screenshots/harness/work-plan'))
const teacherPath = '/student-work-plans'
const start = '2026-11-27'
const end = '2026-12-03'
const twoWeeksEnd = '2026-12-10'
const courseId = 'd74b1a0a-4833-405a-9938-ec9844ffa2d8'
const physicsCourseId = IDS.course
const physicsGroupId = 'f0000000-0000-4000-8000-000000000003'
const catalogTopics = [
  ['cf9472ad-fe30-4803-bee3-b0b1db558c7b', 'Рациональные уравнения', 12],
  ['c4affb86-90fa-4b66-abf7-878ab5ea8593', 'Иррациональные уравнения', 10],
].map(([id, title, count]) => ({
  id, title, course_id: courseId, module_id: 'module-6', module_title: 'Уравнения', ege_numbers: [6],
  homework_id: null, task_count: count, solved: 0, started: false, completed: false, homework_status: null,
  has_theory: true, autocheck: true, available: true, progressive: false, manual_closed: false, tasks: [],
}))
const physicsTopic = {
  ...catalogTopics[0], id: IDS.topic(41), title: 'Закон сохранения импульса', course_id: physicsCourseId,
  module_id: 'module-mechanics', module_title: 'Механика', ege_numbers: [7],
}
const topics = [...catalogTopics, physicsTopic]
const courses = [
  { id: courseId, title: 'ЕГЭ. Математика 1 часть — 11А', progressive: false, group_id: IDS.group },
  { id: physicsCourseId, title: 'ЕГЭ. Физика — 11А', progressive: false, group_id: physicsGroupId },
]
const bothCourseTitles = courses.map(course => course.title).join(' · ')
const savedPlans = new Map()
let stored = null

function resultItem(item, i) {
  const topic = topics.find(candidate => candidate.id === item.topic_id)
  const course = courses.find(candidate => candidate.id === topic.course_id)
  return {
    ...item, course_id: course.id, course_title: course.title, group_id: course.group_id,
    topic_title: topic.title, available: true,
    target: item.target_tasks, solved: i ? 0 : 4, completed_at: null, progress_state: i ? 'todo' : 'started',
  }
}

async function sessionFor(browser, persona, width) {
  const p = personas[persona]
  const session = makeSession(p.user)
  const { context, page } = await newPage(browser, {
    session, staffProfileId: p.staffProfileId, staffMode: p.staffMode ?? 'admin', width,
  })
  const fixtures = baseFixtures(persona)
  fixtures.tables.groups = [{
    id: IDS.group, name: '11А', is_active: true, course_id: courseId,
    courses: { title: courses[0].title, is_template: false },
    group_students: [
      { student_id: IDS.studentRow, students: { profiles: { full_name: 'Тестовый ученик' } } },
      { student_id: IDS.otherStudent(2), students: { profiles: { full_name: 'Ученик без плана' } } },
    ],
  }, {
    id: IDS.group2, name: '10А', is_active: true, course_id: courseId,
    courses: { title: courses[0].title, is_template: false },
    group_students: [{ student_id: IDS.otherStudent(1), students: { profiles: { full_name: 'Ученик другой группы' } } }],
  }, {
    id: physicsGroupId, name: '11А физика', is_active: true, course_id: physicsCourseId,
    courses: { title: courses[1].title, is_template: false },
    group_students: [{ student_id: IDS.studentRow, students: { profiles: { full_name: 'Тестовый ученик' } } }],
  }]
  const rpc = fixtures.rpc
  rpc.student_work_plan_catalog = body => ({
    courses, topics: topics.filter(topic => body.p_course_ids?.includes(topic.course_id)),
  })
  rpc.student_work_plan_read = body => {
    const detail = body.p_view.endsWith('detail')
    const plans = detail ? [savedPlans.get(body.p_plan_id)].filter(Boolean) : [...savedPlans.values()]
    return {
      today: start,
      total_plans: plans.length,
      plans: plans.filter(plan => persona === 'owner' || plan.status === 'published')
        .map(plan => ({ ...plan, items: detail ? plan.items : [] })),
    }
  }
  rpc.student_work_plan_save = body => {
    const items = body.p_items.map(resultItem)
    stored = {
      ...body.p_plan, revision: (savedPlans.get(body.p_plan.id)?.revision ?? 0) + 1, items, student_name: 'Тестовый ученик',
      course_titles: courses.filter(course => body.p_plan.course_ids.includes(course.id)).map(course => course.title),
      total: items.length,
      done: 0, overdue: 0, review: 0, on_time: 0, minutes: 120, today_minutes: 60,
      solved: 4, remaining_tasks: 18, first_correct: 3, attempted: 4, activity_days: 1,
    }
    savedPlans.set(stored.id, stored)
    return { id: stored.id, revision: stored.revision }
  }
  rpc.student_home_courses = () => [{
    course_id: IDS.course, topics_done: 1, topics_total: 5, modules: [],
    work_plans: stored?.status === 'published'
      ? { today: '2026-11-29', plans: [{ ...stored, items: [] }] } : null,
  }]
  rpc.rpc_batch = ({ p_calls }) => p_calls.map(({ fn, args }) => ({
    status: 200, body: typeof rpc[fn] === 'function' ? rpc[fn](args) : rpc[fn] ?? null,
  }))

  const projectRef = new URL(cloudOrigin).hostname.split('.')[0]
  await context.addInitScript(({ session, projectRef }) => {
    localStorage.setItem('sb-' + projectRef + '-auth-token', JSON.stringify(session))
  }, { session, projectRef })
  const requests = []
  const handler = makeHandler({ fixtures, session, assetsDir: 'screenshots/harness/assets', log: line => requests.push(line) })
  await context.route(url => url.origin !== baseOrigin, (route, request) => {
    if (!request.url().startsWith(cloudOrigin + '/')) return handler(route, request)
    const mapped = new Proxy(request, { get(target, key) {
      if (key === 'url') return () => target.url().replace(cloudOrigin, SB)
      const prop = Reflect.get(target, key)
      return typeof prop === 'function' ? prop.bind(target) : prop
    } })
    return handler(route, mapped)
  })
  return { page, context, requests }
}

async function checkWidth(page) {
  const widths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(widths.content).toBeLessThanOrEqual(widths.viewport)
}

async function capture(page, name) {
  await page.waitForFunction(() => {
    const title = document.querySelector('main h1, main h2')
    if (!title) return false
    for (let node = title; node; node = node.parentElement) {
      if (Number(getComputedStyle(node).opacity) < 0.95) return false
    }
    return true
  })
  await page.screenshot({ path: path.join(output, name), animations: 'disabled' })
}

const browser = await chromium.launch({ channel: 'chrome' })
let current
try {
  const teacher = await sessionFor(browser, 'owner', 390)
  current = teacher
  teacher.page.setDefaultTimeout(10_000)
  await teacher.page.goto(BASE + teacherPath)
  const groupSelect = teacher.page.getByRole('combobox', { name: 'Группа', exact: true })
  await expect(groupSelect).toBeDisabled()
  await teacher.page.getByRole('searchbox', { name: 'ФИО ученика' }).fill('другой группы')
  await teacher.page.getByRole('button', { name: 'Ученик другой группы' }).click()
  await expect(groupSelect.getByRole('option', { name: '10А', exact: true })).toHaveCount(1)
  await expect(groupSelect.getByRole('option', { name: '11А', exact: true })).toHaveCount(0)
  await teacher.page.getByRole('searchbox', { name: 'ФИО ученика' }).fill('ученик тестовый')
  await teacher.page.getByRole('button', { name: 'Тестовый ученик', exact: true }).click()
  await groupSelect.selectOption(IDS.group)
  await expect(groupSelect.getByRole('option', { name: '10А', exact: true })).toHaveCount(0)
  await expect(teacher.page.getByText(courses[0].title, { exact: true })).toBeVisible()
  await teacher.page.getByText('Дата начала', { exact: true }).click()
  await expect(teacher.page.getByLabel('Название', { exact: true })).toHaveCount(0)
  await expect(teacher.page.getByLabel('Комментарий к плану')).toHaveCount(0)
  await teacher.page.getByLabel('Начало', { exact: true }).fill(start)
  await teacher.page.getByText('Дата начала', { exact: true }).click()
  await expect(teacher.page.getByRole('radio', { name: '7 дней' })).toBeChecked()
  const addTopic = async topic => {
    const row = teacher.page.getByRole('listitem').filter({ has: teacher.page.getByText(topic.title, { exact: true }) })
    await row.getByRole('button', { name: 'Добавить', exact: true }).click()
  }
  await addTopic(catalogTopics[0])
  const selectedTopics = teacher.page.getByRole('table', { name: 'Темы плана' })
  const mathSettings = selectedTopics.getByRole('button', { name: /Настроить тему.*Рациональные уравнения/ })
  await expect(mathSettings).toHaveAttribute('aria-expanded', 'false')
  await mathSettings.click()
  await expect(selectedTopics.getByRole('checkbox', { name: 'Обязательное' })).toBeChecked()
  await expect(selectedTopics.getByLabel('Комментарий к заданию')).toHaveCount(0)
  await checkWidth(teacher.page)
  await mathSettings.click()
  await teacher.page.getByRole('button', { name: 'Добавить из другого курса' }).click()
  await expect(groupSelect).toBeFocused()
  await groupSelect.selectOption('')
  await expect(selectedTopics.getByRole('rowheader', { name: /Рациональные уравнения/ })).toBeVisible()
  await groupSelect.selectOption(physicsGroupId)
  await addTopic(physicsTopic)
  await groupSelect.selectOption(IDS.group)
  await expect(selectedTopics.getByRole('rowheader', { name: /Рациональные уравнения.*Математика/ })).toBeVisible()
  await expect(selectedTopics.getByRole('rowheader', { name: /Закон сохранения импульса.*Физика/ })).toBeVisible()
  await teacher.page.getByRole('radio', { name: '14 дней' }).check()
  await expect(teacher.page.getByText('Выполнить до 10 дек. включительно')).toBeVisible()
  await expect(teacher.page.getByLabel('Дедлайн', { exact: true })).toHaveCount(0)
  await checkWidth(teacher.page)
  await capture(teacher.page, 'teacher-mobile.png')
  await selectedTopics.screenshot({ path: path.join(output, 'teacher-topics-mobile.png'), animations: 'disabled' })
  await teacher.page.getByRole('button', { name: 'Сохранить черновик' }).click()
  await expect(teacher.page.getByText('Черновик сохранён.')).toBeVisible()
  expect(stored).toMatchObject({ student_id: IDS.studentRow, course_ids: [courseId, physicsCourseId], ends_on: twoWeeksEnd })
  expect(stored.items.map(item => [item.topic_id, item.required, item.note || '']))
    .toEqual([[catalogTopics[0].id, true, ''], [physicsTopic.id, true, '']])
  expect(stored.items.map(i => [i.scheduled_on, i.due_on])).toEqual([[start, twoWeeksEnd], [start, twoWeeksEnd]])
  await teacher.page.getByText('Другие планы', { exact: true }).click()
  await teacher.page.getByRole('link', { name: /Тестовый ученик.*Математика/ }).click()
  await teacher.page.getByRole('button', { name: 'Редактировать' }).click()
  await expect(teacher.page.getByRole('radio', { name: '14 дней' })).toBeChecked()
  const itemIds = stored.items.map(item => item.id)
  await teacher.page.getByRole('radio', { name: '7 дней' }).check()
  await teacher.page.getByRole('button', { name: 'Опубликовать', exact: true }).click()
  await expect(teacher.page.getByRole('heading', { name: bothCourseTitles, exact: true })).toBeVisible()
  expect(stored.status).toBe('published')
  expect(stored.items.map(i => [i.id, i.scheduled_on, i.due_on])).toEqual(itemIds.map(id => [id, start, end]))
  await teacher.page.getByRole('link', { name: 'Все планы' }).click()
  const active = teacher.page.getByRole('region', { name: 'Планы работы' })
  await expect(active.getByRole('listitem')).toHaveCount(1)
  await expect(active.getByRole('link', { name: /Тестовый ученик.*Математика/ })).toBeVisible()
  await teacher.page.getByText('Результаты по группам', { exact: true }).click()
  await teacher.page.getByRole('combobox', { name: 'Группа для результатов' }).selectOption(IDS.group)
  await expect(teacher.page.getByRole('table', { name: 'Результаты группы 11А по неделям' })).toBeVisible()
  await checkWidth(teacher.page)
  await teacher.context.close()

  for (const width of [360, 390]) {
    const student = await sessionFor(browser, 'student', width)
    current = student
    await student.page.goto(BASE + '/student')
    const card = student.page.getByTestId('home-work-plan')
    await expect(card.getByText('Срок до 3 дек.')).toBeVisible()
    await expect(card.getByText(bothCourseTitles, { exact: true })).toBeVisible()
    await expect(card.getByText('В процессе')).toBeVisible()
    await expect(card.getByText('На сегодня')).toHaveCount(0)
    await checkWidth(student.page)
    await card.screenshot({ path: path.join(output, `student-home-${width}.png`), animations: 'disabled' })
    const requestsBeforeDetail = student.requests.filter(line => line.startsWith('RPC student_work_plan_read'))
    expect(requestsBeforeDetail).toHaveLength(0)
    await card.getByRole('link', { name: 'Открыть весь план' }).click()
    await expect(student.page.getByRole('heading', { name: 'Мой план работы', level: 1 })).toBeVisible()
    await expect(student.page.getByText('27 нояб. — 3 дек.', { exact: true })).toBeVisible()
    await expect(student.page.getByText(courses[0].title, { exact: true }).first()).toBeVisible()
    await expect(student.page.getByRole('heading', { name: 'Темы плана' })).toBeVisible()
    await expect(student.page.getByRole('heading', { name: /^Неделя 1/ })).toHaveCount(0)
    await expect(student.page.getByRole('link', { name: physicsTopic.title, exact: true }))
      .toHaveAttribute('href', `/my-course/${physicsGroupId}/topic/${physicsTopic.id}?tab=homework`)
    const topicLink = student.page.getByRole('link', { name: 'Рациональные уравнения', exact: true })
    const topicHref = `/my-course/${IDS.group}/topic/${catalogTopics[0].id}?tab=homework`
    await expect(topicLink).toHaveAttribute('href', topicHref)
    await checkWidth(student.page)
    await capture(student.page, `student-detail-${width}.png`)
    expect(student.requests.filter(line => line.startsWith('RPC student_work_plan_read'))).toHaveLength(1)
    await topicLink.click()
    await expect(student.page).toHaveURL(BASE + topicHref)
    await student.context.close()
  }
  const desktop = await sessionFor(browser, 'owner', 1280)
  current = desktop
  savedPlans.set(stored.id, { ...stored, done: stored.total })
  await desktop.page.goto(BASE + teacherPath)
  await desktop.page.getByRole('searchbox', { name: 'ФИО ученика' }).fill('Тестовый')
  await desktop.page.getByRole('button', { name: 'Тестовый ученик', exact: true }).click()
  await desktop.page.getByRole('combobox', { name: 'Группа', exact: true }).selectOption(IDS.group)
  await desktop.page.getByRole('listitem').filter({ has: desktop.page.getByText('Рациональные уравнения', { exact: true }) })
    .getByRole('button', { name: 'Добавить', exact: true }).click()
  await desktop.page.getByRole('button', { name: 'Назначить план', exact: true }).click()
  await expect(desktop.page.getByText('План назначен.')).toBeVisible()
  const results = desktop.page.getByRole('region', { name: 'Планы работы' })
  await expect(results.getByRole('listitem')).toHaveCount(2)
  await results.getByRole('button', { name: 'Выполнено', exact: true }).click()
  await expect(results.getByRole('listitem')).toHaveCount(1)
  await expect(results.getByRole('link', { name: /Тестовый ученик.*Выполнено/ })).toBeVisible()
  await results.getByRole('button', { name: 'В процессе', exact: true }).click()
  await expect(results.getByRole('link', { name: /Тестовый ученик.*В процессе/ })).toBeVisible()
  await results.getByRole('button', { name: 'Не начато', exact: true }).click()
  await expect(results.getByText('Нет планов с таким статусом.')).toBeVisible()
  await results.getByRole('button', { name: 'Все', exact: true }).click()
  await desktop.page.getByText('Результаты по группам', { exact: true }).click()
  await desktop.page.getByRole('combobox', { name: 'Группа для результатов' }).selectOption(IDS.group)
  const table = desktop.page.getByRole('table', { name: 'Результаты группы 11А по неделям' })
  await expect(table.getByRole('columnheader', { name: /23 нояб\. — 29 нояб\./ })).toBeVisible()
  await expect(table.getByRole('row', { name: /Тестовый ученик/ }).getByText('2 из 3')).toBeVisible()
  await expect(table.getByRole('row', { name: /Ученик без плана/ }).getByRole('cell', { name: '—', exact: true })).toHaveCount(4)
  await checkWidth(desktop.page)
  await capture(desktop.page, 'teacher-active-desktop.png')
  await desktop.context.close()
  console.log('Work plans: multi-course selection, compact topics, shared 7/14-day deadline, active list at 390px, student flat list at 360/390px.')
} catch (error) {
  if (current) {
    console.error(current.page.url(), (await current.page.locator('body').innerText()).slice(0, 1200), current.requests.slice(-16))
  }
  throw error
} finally {
  await browser.close()
}
