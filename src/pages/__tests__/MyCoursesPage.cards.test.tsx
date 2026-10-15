import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * «Мои курсы» в стиле лендинга (письмо ЛК_стиль_мои_курсы.md, 15.10).
 * Скрин владельца: курс по прохождению показывал кольцо 100% и «108 / 108 тем
 * открыто · Без ограничений» — карточка считала все темы курса на клиенте.
 * Теперь прогресс — только `student_home_courses()`, доступ — по типу.
 */

const queried: string[] = []
const db = vi.hoisted(() => ({
  groups: [] as unknown[],
  rpc: {} as Record<string, unknown>,
  tables: {} as Record<string, unknown>,
  subsOn: false,
}))

function chain(data: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'not', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data, error: null })
  c.maybeSingle = () => Promise.resolve({ data, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      queried.push(table)
      if (table === 'students') return chain({ id: 'student-1' })
      if (table === 'group_students') return chain(db.groups.map(g => ({ groups: g })))
      return chain(db.tables[table] ?? [])
    },
    rpc: (name: string) => {
      queried.push(`rpc:${name}`)
      return Promise.resolve({ data: db.rpc[name] ?? null, error: null })
    },
  },
}))
// Флаг подписки кешируется на модуль (useCachedFlag) — в тестах задаём прямо.
vi.mock('@/hooks/useSubscription', async (orig) => ({
  ...(await orig<object>()),
  useSubscriptionsEnabled: () => ({ enabled: db.subsOn, loading: false }),
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'profile-1', role: 'student' } }),
}))

import { MyCoursesPage } from '@/pages/MyCoursesPage'

const group = (id: string, courseId: string, title: string, teacher: string | null = null) => ({
  id, name: `Группа ${id}`, course_id: courseId,
  teachers: teacher ? { profiles: { full_name: teacher } } : null,
  courses: { id: courseId, title, subject: 'physics', exam_type: 'ege' },
})
const progress = (courseId: string, done: number, total: number, next: { topic_id: string; title: string } | null) => ({
  course_id: courseId, topics_done: done, topics_total: total,
  modules: [{ module_id: 'm1', title: 'Кинематика', done, total }],
  continue: next ? { ...next, module_title: 'Кинематика' } : null,
})
const DAY = 86_400_000
const sub = (courseId: string, extra: Record<string, unknown>) => ({
  subscription_id: `s-${courseId}`, course_id: courseId, course_title: 'x', group_id: null, tariff_id: `tar-${courseId}`,
  status: 'active', source: 'purchase', demo: false, has_access: true,
  access_until: new Date(Date.now() + 30 * DAY).toISOString(), auto_renew: true, continue: null, ...extra,
})

function renderPage() {
  return render(<MemoryRouter><MyCoursesPage /></MemoryRouter>)
}

beforeEach(() => {
  queried.length = 0
  db.groups = []
  db.rpc = {}
  db.tables = {}
  db.subsOn = false
})

describe('карточка курса', () => {
  it('прогресс — student_home_courses: «пройдено 6 из 108», а не «108 / 108 открыто»; модулей и тем не считает', async () => {
    db.groups = [group('g1', 'c1', 'Физика ЕГЭ — подписка (тест)')]
    db.rpc.student_home_courses = [progress('c1', 6, 108, { topic_id: 't7', title: 'Равноускоренное движение' })]
    db.tables.course_unlock_modes = [{ course_id: 'c1', mode: 'progress' }]
    db.tables.course_showcase = [{ course_id: 'c1', title: 'Физика ЕГЭ' }]
    renderPage()
    const card = await screen.findByTestId('course-card')
    expect(await within(card).findByText('пройдено 6 из 108')).toBeInTheDocument()
    expect(within(card).getByText('6%')).toBeInTheDocument()
    expect(within(card).getByTestId('course-title')).toHaveTextContent('Физика ЕГЭ')
    expect(within(card).getByTestId('course-title')).not.toHaveTextContent('(тест)')
    expect(within(card).getByTestId('course-mode')).toHaveTextContent('по прохождению')
    expect(within(card).getByTestId('course-continue')).toHaveTextContent('Продолжить: Равноускоренное движение')
    expect(within(card).getByTestId('course-continue')).toHaveAttribute('href', '/my-course/g1/topic/t7')
    expect(queried).not.toContain('modules')
    // «Что дальше» справа убран (владелец 15.10).
    expect(screen.queryByTestId('course-next')).toBeNull()
  })

  it('нечего продолжать: «Курс пройден» или «Ждём открытия следующей темы»', async () => {
    db.groups = [group('g1', 'c1', 'A'), group('g2', 'c2', 'B')]
    db.rpc.student_home_courses = [progress('c1', 10, 10, null), progress('c2', 3, 10, null)]
    renderPage()
    expect(await screen.findByText('Курс пройден')).toBeInTheDocument()
    expect(screen.getByText('Ждём открытия следующей темы')).toBeInTheDocument()
  })
})

describe('строка доступа', () => {
  it('школьная группа — учитель, без цены и сроков', async () => {
    db.groups = [group('g1', 'c1', 'Физика ЕГЭ 11А', 'Иванова Мария')]
    renderPage()
    const access = await screen.findByTestId('course-access')
    expect(access).toHaveAttribute('data-kind', 'school')
    expect(access).toHaveTextContent('Школьная группа · Иванова Мария')
  })

  it('подписка — «до …, автопродление»; пробный — «осталось N дней» и «Оформить подписку»; истекла — «Продлить»', async () => {
    db.groups = [group('g1', 'c1', 'A'), group('g2', 'c2', 'B'), group('g3', 'c3', 'C')]
    db.subsOn = true
    db.rpc.student_path_home = {
      onboarding: { needed: false, completed: true },
      subscriptions: [
        sub('c1', {}),
        sub('c2', { status: 'trial', source: 'trial', demo: true, access_until: new Date(Date.now() + 2 * DAY - 60_000).toISOString() }),
        sub('c3', { status: 'expired', has_access: false, access_until: new Date(Date.now() - DAY).toISOString() }),
      ],
    }
    renderPage()
    await screen.findByText(/осталось 2 дня/)
    const byKind = Object.fromEntries(screen.getAllByTestId('course-access').map(a => [a.getAttribute('data-kind'), a]))
    expect(byKind.subscription).toHaveTextContent(/Подписка до .* · автопродление вкл/)
    expect(within(byKind.subscription).getByRole('link', { name: 'Моя подписка' })).toHaveAttribute('href', '/my-subscription')
    expect(byKind.trial).toHaveTextContent('Пробный период · осталось 2 дня')
    expect(within(byKind.trial).getByRole('link', { name: 'Оформить подписку' })).toHaveAttribute('href', '/subscribe/checkout/tar-c2')
    expect(byKind.expired).toHaveTextContent(/Доступ закончился/)
    expect(within(byKind.expired).getByRole('link', { name: 'Продлить' })).toBeInTheDocument()
  })
})

describe('список', () => {
  it('вариант «Б»: кольцо «23%», под ним «открыто 28%», «6 можно делать сейчас», лестница разделов', async () => {
    db.groups = [group('g1', 'c1', 'Физика')]
    db.rpc.student_home_courses = [{
      course_id: 'c1', topics_done: 23, topics_total: 102,
      modules: [
        { module_id: 'm1', title: 'Математика для физики', done: 8, total: 8 },
        { module_id: 'm2', title: 'Кинематика', done: 15, total: 24 },
        { module_id: 'm3', title: 'Динамика', done: 0, total: 22 },
        { module_id: 'm4', title: 'Законы сохранения', done: 0, total: 48 },
      ],
      continue: { topic_id: 't1', title: 'Свободное падение', module_title: 'Кинематика' },
    }]
    // Открытые ДЗ, которые база отдаёт ученику: m1 — 8 тем, m2 — 19, m3 — 2.
    const hw = (m: string, n: number) => Array.from({ length: n }, (_, k) => ({ topic_id: `${m}-t${k}`, topic: { module_id: m } }))
    db.tables.topic_homework = [...hw('m1', 8), ...hw('m2', 19), ...hw('m3', 2)]
    renderPage()
    const card = await screen.findByTestId('course-card')
    expect(await within(card).findByTestId('course-open-pct')).toHaveTextContent('открыто 28%')
    expect(within(card).getByTestId('course-ring')).toHaveTextContent('23%')
    expect(within(card).getByTestId('course-available')).toHaveTextContent('6 можно делать сейчас')
    const steps = within(card).getAllByTestId('ladder-step')
    expect(steps.map(st => st.textContent)).toEqual(['Математика для физики✓', 'Кинематика15/24', 'Динамика0/22', 'Законы сохранения0/48'])
    expect(steps[1]).toHaveClass('is-cur')
    expect(steps[2]).toHaveClass('is-cur')
    expect(steps[3]).toHaveClass('is-future')
    expect(screen.queryByTestId('course-next')).toBeNull()
  })

  it('нет курсов — «Курсов пока нет», диагностика и витрина', async () => {
    renderPage()
    const empty = await screen.findByTestId('my-courses-empty')
    expect(within(empty).getByRole('link', { name: 'Пройти диагностику' })).toHaveAttribute('href', '/diagnostic')
    expect(within(empty).getByRole('link', { name: /Выбрать курс/ })).toHaveAttribute('href', '/courses')
  })
})
