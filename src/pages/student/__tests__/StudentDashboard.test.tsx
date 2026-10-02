import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { StudentWeekCourse } from '@/hooks/useStudentWeekPlan'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { buildStudentTodo, type StudentTodo, type TodoHomework, type TodoVerdict } from '@/lib/studentTodo'
import {
  filterHomeworkByCourse, homeworkCourseOptions, splitHomeworkBuckets, type TopicJournalHomework,
} from '@/lib/topicJournal'
import type { HomeActivity } from '@/lib/studentHome'

/**
 * §254. Главная ученика: кнопки-счётчики вместо списков, серия с
 * календарём, задачи по неделям, «Мои курсы». Переписан целиком: прежние
 * проверки стерегли плитки StatCard, «Последние ДЗ», баннер «У вас N работ на
 * доработке» — всё это снято с главной по макету владельца 02.10 (кнопка
 * «Вернули на доработку» заменяет баннер).
 *
 * Хуки подменены, но список дел собирается НАСТОЯЩИМ `buildStudentTodo`, а
 * страница ДЗ раскладывает строки настоящими функциями `lib/topicJournal`:
 * проверяется стык «кнопка → список», а не выдумка теста.
 */

const TODAY = new Date().toLocaleDateString('en-CA')
const dayShift = (n: number) => {
  const d = new Date(`${TODAY}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const state = {
  todo: buildStudentTodo({ rawAttempts: [], homework: [], tests: [], verdicts: [] }) as StudentTodo,
  activity: null as HomeActivity | null,
  activityError: null as string | null,
  journal: [] as TopicJournalHomework[],
  courses: [] as Array<{ courseId: string; groupId: string; courseTitle: string; subject: string | null }>,
}

const useStudentWeekPlanMock = vi.fn(() => ({ courses: [] as StudentWeekCourse[], loading: false, error: null as string | null }))
vi.mock('@/hooks/useStudentWeekPlan', () => ({ useStudentWeekPlan: () => useStudentWeekPlanMock() }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'profile-1', full_name: 'Shavaleev Almir' } }),
}))
const useStudentDashboardMock = vi.fn()
vi.mock('@/hooks/useStudentDashboard', () => ({ useStudentDashboard: (...a: unknown[]) => useStudentDashboardMock(...a) }))
vi.mock('@/hooks/useStudentTodo', () => ({
  useStudentTodo: (profileId?: string) => ({ todo: state.todo, loading: false, error: null, reload: vi.fn(), _for: profileId }),
}))
const retry = vi.fn()
vi.mock('@/hooks/useStudentHomeActivity', () => ({
  useStudentHomeActivity: () => ({ activity: state.activity, loading: false, error: state.activityError, retry }),
}))
vi.mock('@/hooks/useStudentTopicJournal', () => ({
  useStudentTopicJournal: () => ({ journal: { homework: state.journal, tests: [], summary: {} }, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/hooks/useMyMockExams', () => ({ useMyMockExams: () => ({}) }))
vi.mock('@/hooks/useMyTopicHomework', () => ({
  useMyTopicHomework: (courseId: string | null = null) => {
    const courseOptions = homeworkCourseOptions(state.journal, [])
    const activeCourseId = courseId && courseOptions.some(o => o.id === courseId) ? courseId : null
    return {
      buckets: splitHomeworkBuckets(filterHomeworkByCourse(state.journal, activeCourseId)),
      totalRows: state.journal.length, courseOptions, activeCourseId, summary: null,
      topicLink: () => null, courseSubject: () => null,
      loading: false, error: null, reload: vi.fn(), noStudentRecord: false,
    }
  },
}))

import { StudentDashboard } from '@/pages/student/StudentDashboard'
import { MyTopicHomeworkPage } from '@/pages/student/MyTopicHomeworkPage'

const open = { is_open: true, available_from: null }
function hw(id: string, dueAt: string | null, topicTitle = `Тема ${id}`): TodoHomework {
  return {
    homeworkId: id, homeworkTitle: 'Домашнее задание', topicId: `t-${id}`, topicTitle,
    courseId: 'c1', courseTitle: 'Физика ЕГЭ', courseSubject: 'physics', groupId: 'g1', dueAt, topic: open,
  }
}
function journalRow(id: string, status: TopicJournalHomework['status'], over: Partial<TopicJournalHomework> = {}): TopicJournalHomework {
  return {
    homework_id: id, title: 'Домашнее задание', topic_id: `t-${id}`, topic_title: `Тема ${id}`, module_title: null,
    course_id: 'c1', course_title: 'Физика ЕГЭ', due_at: null, grade_scale: 'five', status,
    score: null, comment: null, submitted_at: null, reviewed_at: null, attempts_count: 0, is_overdue: false, ...over,
  }
}
const verdict = (attemptId: string, homeworkId: string, createdAt: string, topicTitle: string, score: number): TodoVerdict => ({
  attemptId, homeworkId, topicTitle, homeworkTitle: 'Домашнее задание', decision: 'accepted', score, gradeScale: 'five', comment: null, createdAt,
})

function activity(over: Partial<HomeActivity> = {}): HomeActivity {
  return { today: TODAY, from: dayShift(-83), streak: 0, record: 0, visitedToday: false, visits: [], solved: [], courses: [], ...over }
}

/** Ученик как у 11А: 2 просрочки (давняя — 40 дней), 3 в окне, работы до мая, 2 свежие оценки. */
function typicalStudent() {
  const homework = [
    hw('o1', dayShift(-40)), hw('o2', dayShift(-3)),
    hw('s1', dayShift(9), 'Динамика'), hw('s2', dayShift(11)), hw('s3', dayShift(14)),
    hw('l1', dayShift(30)), hw('l2', dayShift(200)),
    hw('a1', dayShift(-20), 'Производные'), hw('a2', dayShift(-25), 'Кинематика'),
  ]
  const rawAttempts = ['a1', 'a2'].map((id, i) => ({
    id: `att-${id}`, student_id: 's', status: 'accepted', attempt_number: 1, submitted_at: `${dayShift(-5 - i)}T10:00:00Z`,
    homework: { id, title: 'Домашнее задание', grade_scale: 'five', due_at: null, topic: { id: `t-${id}`, title: 'x', module: { id: 'm', course: { id: 'c1', title: 'Физика ЕГЭ' } } } },
  }))
  state.todo = buildStudentTodo({
    rawAttempts, homework, tests: [],
    verdicts: [verdict('att-a1', 'a1', `${dayShift(-1)}T12:00:00Z`, 'Производные', 4), verdict('att-a2', 'a2', `${dayShift(-2)}T12:00:00Z`, 'Кинематика', 5)],
  })
  state.journal = [
    ...['o1', 'o2'].map(id => journalRow(id, 'not_started', { is_overdue: true, due_at: id === 'o1' ? dayShift(-40) : dayShift(-3) })),
    ...['s1', 's2', 's3', 'l1', 'l2'].map(id => journalRow(id, 'not_started', { due_at: dayShift(9) })),
    journalRow('a1', 'accepted', { score: 4, reviewed_at: `${dayShift(-1)}T12:00:00Z` }),
    journalRow('a2', 'accepted', { score: 5, reviewed_at: `${dayShift(-2)}T12:00:00Z` }),
  ]
}

function renderHome(initial = '/student') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/student" element={<StudentDashboard />} />
        <Route path="/my-homework" element={<MyTopicHomeworkPage />} />
        <Route path="/my-course/:groupId" element={<p>страница курса</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  state.todo = buildStudentTodo({ rawAttempts: [], homework: [], tests: [], verdicts: [] })
  state.activity = activity()
  state.activityError = null
  state.journal = []
  state.courses = []
  useStudentDashboardMock.mockImplementation(() => ({ courses: state.courses, studentId: 'st-1', loading: false }))
})

describe('главная ученика — кнопки-счётчики (§254)', () => {
  it('просрочено, сдать за 2 недели, новые оценки — счёт и подписи', () => {
    typicalStudent()
    renderHome()
    const overdue = screen.getByTestId('home-action-overdue')
    expect(overdue).toHaveTextContent('2')
    expect(overdue).toHaveTextContent('Просрочено')
    expect(overdue).toHaveTextContent('самое давнее — 40 дней')
    const soon = screen.getByTestId('home-action-soon')
    expect(soon).toHaveTextContent('3')
    expect(soon).toHaveTextContent('Сдать за 2 недели')
    expect(soon).toHaveTextContent('ближайшее — через 9 дней')
    const grades = screen.getByTestId('home-action-checked')
    expect(grades).toHaveTextContent('2')
    expect(grades).toHaveTextContent('«Производные» — 4/5')
    // Работы до мая — не кнопкой: окно 14 дней не пусто.
    expect(screen.queryByTestId('home-action-later')).toBeNull()
    expect(screen.queryByTestId('student-todo-clear')).toBeNull()
  })

  it('кнопки — ссылки на страницу ДЗ с фильтром', () => {
    typicalStudent()
    renderHome()
    expect(screen.getByTestId('home-action-overdue')).toHaveAttribute('href', '/my-homework?show=overdue')
    expect(screen.getByTestId('home-action-soon')).toHaveAttribute('href', '/my-homework?show=soon')
    expect(screen.getByTestId('home-action-checked')).toHaveAttribute('href', '/my-homework?show=checked')
  })

  it.each([
    ['overdue', 'Просрочено', ['Тема o1', 'Тема o2']],
    ['soon', 'Сдать за 2 недели', ['Тема s1', 'Тема s2', 'Тема s3']],
    ['checked', 'Новые оценки', ['Тема a1', 'Тема a2']],
  ])('кнопка «%s» открывает страницу ДЗ сразу нужным списком', (show, title, topics) => {
    typicalStudent()
    renderHome()
    fireEvent.click(screen.getByTestId(`home-action-${show}`))
    const list = screen.getByTestId('my-hw-show')
    expect(list).toHaveAttribute('data-show', show)
    expect(within(list).getByRole('heading', { level: 1 })).toHaveTextContent(title)
    const rows = within(list).getAllByTestId('my-hw-row').map(r => r.querySelector('h3')?.textContent)
    expect(rows).toEqual(topics)
    // Путь назад ко всем заданиям есть всегда.
    expect(within(list).getByTestId('my-hw-show-all')).toHaveAttribute('href', '/my-homework')
  })

  it('кнопка с нулём не рисуется', () => {
    state.todo = buildStudentTodo({ rawAttempts: [], homework: [hw('o1', dayShift(-2))], tests: [], verdicts: [] })
    renderHome()
    expect(screen.getByTestId('home-action-overdue')).toHaveTextContent('1')
    expect(screen.queryByTestId('home-action-soon')).toBeNull()
    expect(screen.queryByTestId('home-action-later')).toBeNull()
    expect(screen.queryByTestId('home-action-checked')).toBeNull()
  })

  it('всё по нулям — спокойная строка «Всё сдано, новых заданий нет», кнопок нет', () => {
    renderHome()
    expect(screen.getByTestId('student-todo-clear')).toHaveTextContent('Всё сдано, новых заданий нет')
    expect(screen.queryAllByTestId(/^home-action-/)).toHaveLength(0)
  })

  it('окно 14 дней пусто, работы позже есть — «Сдать позже» с датой ближайшей, ведёт в свой список', () => {
    state.todo = buildStudentTodo({ rawAttempts: [], homework: [hw('l1', dayShift(20)), hw('l2', dayShift(90))], tests: [], verdicts: [] })
    state.journal = [journalRow('l1', 'not_started', { due_at: dayShift(20) }), journalRow('l2', 'not_started', { due_at: dayShift(90) })]
    renderHome()
    const later = screen.getByTestId('home-action-later')
    expect(later).toHaveTextContent('Сдать позже')
    const [, m, d] = dayShift(20).split('-').map(Number)
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
    expect(later).toHaveTextContent(`ближайшее — ${d} ${months[m - 1]}`)
    expect(later).toHaveAttribute('href', '/my-homework?show=later')
    fireEvent.click(later)
    expect(within(screen.getByTestId('my-hw-show')).getAllByTestId('my-hw-row')).toHaveLength(2)
  })

  it('вернули на доработку — своей кнопкой; без срока и тестирования — строкой ссылок, не теряются', () => {
    state.todo = buildStudentTodo({
      rawAttempts: [{ id: 'r', student_id: 's', status: 'returned_for_revision', attempt_number: 1, submitted_at: `${dayShift(-3)}T10:00:00Z`,
        homework: { id: 'r1', title: 'ДЗ', grade_scale: 'five', due_at: null, topic: { id: 't-r1', title: 'x', module: { id: 'm', course: { id: 'c1', title: 'Ф' } } } } }],
      homework: [hw('r1', null, 'Законы Ньютона'), hw('n1', null), hw('n2', null)],
      tests: [{ assignmentId: 'ta', testId: 'tt', testTitle: 'Кинематика', topicId: 't9', topicTitle: 'Т', completed: false, groupId: 'g1' }],
      verdicts: [],
    })
    renderHome()
    expect(screen.getByTestId('home-action-returned')).toHaveTextContent('Вернули на доработку')
    expect(screen.getByTestId('home-action-returned')).toHaveTextContent('«Законы Ньютона»')
    const extras = screen.getByTestId('home-extras')
    expect(within(extras).getByText('Без срока: 2')).toHaveAttribute('href', '/my-homework?show=nodue')
    expect(within(extras).getByText('Тестирование «Кинематика»')).toHaveAttribute('href', '/my-course/g1/topic/t9')
    expect(screen.queryByTestId('student-todo-clear')).toBeNull()
  })
})

describe('главная ученика — серия и календарь (§254)', () => {
  it('серия и рекорд из базы, точки недели в шапке', () => {
    const monday = (() => { const d = new Date(`${TODAY}T12:00:00Z`); return (d.getUTCDay() + 6) % 7 })()
    state.activity = activity({ streak: 5, record: 12, visitedToday: true, visits: Array.from({ length: 5 }, (_, i) => dayShift(-i)) })
    renderHome()
    expect(screen.getByTestId('streak-pill')).toHaveTextContent('5 дней подряд')
    // Горят дни этой недели с заходами — не больше, чем прошло дней недели.
    const lit = screen.getByTestId('streak-pill').querySelectorAll('[data-on]').length
    expect(lit).toBe(Math.min(5, monday + 1))
    expect(screen.getByTestId('streak-number')).toHaveTextContent('5')
    expect(screen.getByTestId('streak-card')).toHaveTextContent('дней подряд · рекорд — 12 дней')
  })

  it('сегодня ещё не заходил — серия не обнуляется до конца дня, сегодняшняя клетка «не заходили»', () => {
    state.activity = activity({ streak: 3, record: 3, visitedToday: false, visits: [dayShift(-1), dayShift(-2), dayShift(-3)] })
    renderHome()
    expect(screen.getByTestId('streak-pill')).toHaveTextContent('3 дня подряд')
    const today = screen.getByTestId('activity-calendar').querySelector('[data-today]')!
    expect(today.getAttribute('aria-label')).toMatch(/: не заходили$/)
  })

  it('разрыв: серия 0, рекорд остаётся', () => {
    state.activity = activity({ streak: 0, record: 7, visits: [dayShift(-3)] })
    renderHome()
    expect(screen.getByTestId('streak-pill')).toHaveTextContent('Начните серию')
    expect(screen.getByTestId('streak-card')).toHaveTextContent('рекорд — 7 дней')
  })

  it('новичок: серия 0, пустой календарь и дружелюбный текст', () => {
    renderHome()
    expect(screen.getByTestId('streak-number')).toHaveTextContent('0')
    expect(screen.getByTestId('streak-newbie')).toHaveTextContent('Заходите каждый день — здесь появится ваша серия')
    const cells = screen.getByTestId('activity-calendar').querySelectorAll('i')
    expect(cells).toHaveLength(84)
    expect([...cells].filter(c => c.getAttribute('data-level') && c.getAttribute('data-level') !== '0')).toHaveLength(0)
    expect(screen.getByTestId('weeks-empty')).toBeInTheDocument()
  })

  it('клетки: ступени по задачам, будущие дни пустые с пунктиром, подсказка при фокусе', () => {
    state.activity = activity({
      streak: 2, record: 2, visitedToday: true, visits: [dayShift(-1), TODAY],
      solved: [{ day: dayShift(-1), n: 1, hw: 1, catalog: 0, mock: 0, test: 0 }, { day: TODAY, n: 12, hw: 0, catalog: 12, mock: 0, test: 0 }],
    })
    renderHome()
    const cal = screen.getByTestId('activity-calendar')
    expect(cal.querySelector(`[data-day="${dayShift(-1)}"]`)).toHaveAttribute('data-level', '1')
    const today = cal.querySelector('[data-today]') as HTMLElement
    expect(today).toHaveAttribute('data-level', '4')
    const future = cal.querySelectorAll('[data-future]')
    const dow = (new Date(`${TODAY}T12:00:00Z`).getUTCDay() + 6) % 7
    expect(future).toHaveLength(6 - dow)
    future.forEach(f => { expect(f.className).toContain('border-dashed'); expect(f).not.toHaveAttribute('tabindex') })
    fireEvent.focus(today)
    expect(screen.getByTestId('home-tip').textContent).toMatch(/: 12 задач$/)
    fireEvent.blur(today)
    expect(screen.queryByTestId('home-tip')).toBeNull()
  })

  it('база не ответила — главная живёт, вместо серии строка с повтором', () => {
    state.activity = null
    state.activityError = 'function student_home_activity does not exist'
    typicalStudent()
    renderHome()
    expect(screen.queryByTestId('streak-pill')).toBeNull()
    expect(screen.getByTestId('home-action-overdue')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('streak-card')).getByRole('button', { name: 'Повторить' }))
    expect(retry).toHaveBeenCalled()
  })
})

describe('главная ученика — задачи по неделям и курсы (§254)', () => {
  it('10 недель, текущая — акцентом и с числом, подсказка при наведении', () => {
    state.activity = activity({
      streak: 1, record: 1, visitedToday: true, visits: [TODAY],
      solved: [{ day: TODAY, n: 4, hw: 4, catalog: 0, mock: 0, test: 0 }, { day: dayShift(-7), n: 9, hw: 0, catalog: 9, mock: 0, test: 0 }],
    })
    renderHome()
    const bars = within(screen.getByTestId('week-bars')).getAllByRole('listitem')
    expect(bars).toHaveLength(10)
    const current = bars[9]
    expect(current).toHaveAttribute('data-current')
    expect(current).toHaveAttribute('data-n', '4')
    expect(current.textContent).toContain('4')
    expect(bars[8]).toHaveAttribute('data-n', '9')
    fireEvent.mouseEnter(bars[8])
    expect(screen.getByTestId('home-tip').textContent).toMatch(/^неделя с \d+ \S+: 9 задач$/)
  })

  it('«Мои курсы»: тем пройдено, ДЗ принято, средняя оценка; карточка — ссылка на курс', () => {
    state.courses = [
      { courseId: 'c1', groupId: 'g1', courseTitle: 'Физика ЕГЭ 11А', subject: 'physics' },
      { courseId: 'c2', groupId: 'g2', courseTitle: 'Математика ЕГЭ', subject: 'math' },
    ]
    state.activity = activity({ courses: [{ courseId: 'c1', topicsTotal: 52, topicsDone: 9 }, { courseId: 'c2', topicsTotal: 48, topicsDone: 6 }] })
    state.journal = [
      journalRow('h1', 'accepted', { score: 4 }), journalRow('h2', 'accepted', { score: 5 }), journalRow('h3', 'returned'),
      journalRow('m1', 'accepted', { course_id: 'c2', grade_scale: null, score: null }), journalRow('m2', 'not_started', { course_id: 'c2' }),
    ]
    renderHome()
    const [phys, math] = screen.getAllByTestId('home-course')
    expect(phys).toHaveAttribute('href', '/my-course/g1')
    expect(phys).toHaveTextContent('Физика ЕГЭ 11А')
    expect(phys).toHaveTextContent('9 / 52тем пройдено')
    expect(phys).toHaveTextContent('2 / 3ДЗ принято')
    expect(phys).toHaveTextContent('4,5средняя оценка')
    expect(math).toHaveTextContent('6 / 48')
    expect(math).toHaveTextContent('1 / 2')
    expect(math).toHaveTextContent('—средняя оценка')
    fireEvent.click(phys)
    expect(screen.getByText('страница курса')).toBeInTheDocument()
  })

  it('старых плиток и списков на главной нет', () => {
    typicalStudent()
    state.courses = [{ courseId: 'c1', groupId: 'g1', courseTitle: 'Физика', subject: 'physics' }]
    renderHome()
    expect(screen.queryByText('Последние ДЗ')).toBeNull()
    expect(screen.queryByText('Мои тесты')).toBeNull()
    expect(screen.queryByText('Личный маршрут')).toBeNull()
    expect(screen.queryByText('На проверке/доработке')).toBeNull()
    expect(screen.getAllByText('Мои курсы')).toHaveLength(1)
  })

  it('приветствие по прежнему правилу имени и «Эта неделя» по плану (§151) на месте', () => {
    useStudentWeekPlanMock.mockReturnValueOnce({
      courses: [{
        course_id: 'c1', group_id: 'g1', course_title: 'Физика', subject: 'physics',
        week_no: 1, weeks_total: 10, week_start: '2026-09-07', week_end: '2026-09-13',
        deadline: '2026-09-13T21:00:00+00:00',
        topics: [{ topic_id: 't1', title: 'Кинематика', open_now: true, hw_published: true, hw_status: 'not_started', done: false, marked: false }],
      }],
      loading: false, error: null,
    })
    renderHome()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Привет, Almir')
    expect(screen.getByTestId('student-week-plan')).toHaveTextContent('Кинематика')
  })
})
