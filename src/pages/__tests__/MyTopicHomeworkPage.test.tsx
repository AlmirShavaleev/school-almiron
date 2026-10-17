import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import {
  filterHomeworkByCourse, homeworkCourseOptions, splitHomeworkBuckets,
  type TopicJournalHomework,
} from '@/lib/topicJournal'
import { myTopicHref } from '@/lib/studentTopicAccess'
import { buildStudentTodo, type TodoHomework } from '@/lib/studentTodo'

/**
 * Страница списка ДЗ ученика.
 *
 * Хук подменён, но НЕ выдуман: отбор, счётчики и раскладка внутри мока считаются
 * теми же функциями `lib/topicJournal`, что и в проде. Иначе тест проверял бы
 * собственную выдумку — а разъехаться могут именно правило и его применение.
 */

const state = {
  rows: [] as TopicJournalHomework[],
  courses: [] as Array<{ courseId: string; title: string; subject: string | null }>,
  /** Курс → группа: тот же источник адреса, что и в проде (§123.7). */
  groups: new Map<string, string>([['c1', 'g1'], ['c2', 'g2']]),
  loading: false,
  error: null as string | null,
  noStudentRecord: false,
  /** Курсы «Мой курс» — их ДЗ в группе «Уроки», остальные — «Школа». */
  lessonCourseIds: new Set<string>(),
}

vi.mock('@/hooks/useMyTopicHomework', () => ({
  useMyTopicHomework: (courseId: string | null = null) => {
    // Строки раздела — строки журнала с признаком автопроверки (lib/homeworkBoard).
    const rows = state.rows.map(r => ({ autocheck: false, left: null, total: null, ...r }))
    const courseOptions = homeworkCourseOptions(state.rows, state.courses)
    const activeCourseId = courseId && courseOptions.some(o => o.id === courseId) ? courseId : null
    return {
      buckets: splitHomeworkBuckets(filterHomeworkByCourse(rows, activeCourseId)),
      lessonCourseIds: state.lessonCourseIds,
      totalRows: state.rows.length,
      courseOptions,
      activeCourseId,
      summary: null,
      // Адрес собирает то же общее правило, что и хук: подменён источник
      // групп, а не способ строить путь.
      topicLink: (row: TopicJournalHomework) => myTopicHref(state.groups.get(row.course_id), row.topic_id),
      courseSubject: (row: TopicJournalHomework) =>
        state.courses.find(c => c.courseId === row.course_id)?.subject ?? null,
      loading: state.loading,
      error: state.error,
      reload: vi.fn(),
      noStudentRecord: state.noStudentRecord,
    }
  },
}))

// §254: список по кнопке главной (`?show=…`) берёт состав из `studentTodo` —
// подменён хук загрузки, сама раскладка — настоящий `buildStudentTodo`.
const todoState = { todo: buildStudentTodo({ rawAttempts: [], homework: [], tests: [], verdicts: [] }) }
const useStudentTodoMock = vi.fn((profileId?: string) => ({ todo: todoState.todo, loading: false, error: null, reload: vi.fn(), profileId }))
vi.mock('@/hooks/useStudentTodo', () => ({ useStudentTodo: (p?: string) => useStudentTodoMock(p) }))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ profile: { id: 'profile-1', full_name: 'Иванова Анна' } }),
}))

import { MyTopicHomeworkPage } from '@/pages/student/MyTopicHomeworkPage'

function hw(over: Partial<TopicJournalHomework> & { homework_id: string; status: TopicJournalHomework['status'] }): TopicJournalHomework {
  return {
    title: 'ДЗ по кинематике',
    topic_id: 't1', topic_title: 'Кинематика', module_title: null,
    course_id: 'c1', course_title: 'Физика ЕГЭ',
    due_at: null, grade_scale: 'five', score: null, comment: null,
    submitted_at: null, reviewed_at: null, attempts_count: 0, is_overdue: false,
    ...over,
  }
}

/** Показывает текущий адрес, чтобы проверять состояние фильтра в query. */
function AddressBar() {
  const location = useLocation()
  return <div data-testid="address">{location.pathname}{location.search}</div>
}

function renderPage(initial = '/my-homework') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AddressBar />
      <Routes>
        <Route path="/my-homework" element={<MyTopicHomeworkPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const TWO_COURSES = [
  { courseId: 'c1', title: 'Физика ЕГЭ', subject: 'physics' },
  { courseId: 'c2', title: 'Математика ЕГЭ', subject: 'math' },
]

describe('MyTopicHomeworkPage — список ДЗ ученика', () => {
  beforeEach(() => {
    state.rows = []
    state.courses = []
    state.groups = new Map([['c1', 'g1'], ['c2', 'g2']])
    state.loading = false
    state.error = null
    state.noStudentRecord = false
    state.lessonCourseIds = new Set()
  })

  it('показывает предстоящее ДЗ, которое ученик ещё не начинал', () => {
    // Срок — относительно сегодняшнего дня (по локальному календарю): карточка
    // печатает остаток словами, жёсткая дата протухла бы сама.
    const due = new Date()
    due.setDate(due.getDate() + 10)
    const inTenDays = due.toLocaleDateString('en-CA')
    state.rows = [hw({ homework_id: 'a', status: 'not_started', due_at: inTenDays })]
    renderPage()

    const row = screen.getByTestId('my-hw-row')
    expect(within(row).getByText('Кинематика')).toBeInTheDocument()
    expect(within(row).getByTestId('hw-status')).toHaveTextContent('сдать')
    expect(within(row).getByText('2 часть')).toBeInTheDocument()
    expect(row.textContent).toContain('осталось 10 дней')
    expect(screen.getByTestId('my-hw-count')).toHaveTextContent('Нужно сделать: 1')
  })

  it('принятое — свёрнуто внизу «Принято: N»; раскрыл — балл и комментарий учителя', () => {
    state.rows = [hw({
      homework_id: 'b', status: 'accepted', score: 4, grade_scale: 'five',
      comment: 'Проверь знаки в третьем действии', reviewed_at: '2026-07-29T10:00:00Z',
    })]
    renderPage()

    expect(screen.queryByTestId('my-hw-row')).toBeNull()
    fireEvent.click(screen.getByTestId('my-hw-done-toggle'))
    const row = screen.getByTestId('my-hw-row')
    expect(within(row).getByTestId('hw-status')).toHaveTextContent('принято · 4 / 5')
    expect(within(row).getByTestId('hw-comment')).toHaveTextContent('Проверь знаки в третьем действии')
  })

  it('помечает просроченное и выносит счёт просрочек в подзаголовок', () => {
    state.rows = [hw({ homework_id: 'c', status: 'not_started', is_overdue: true, due_at: '2026-07-01T00:00:00Z' })]
    renderPage()

    expect(screen.getByTestId('my-hw-row').textContent).toMatch(/просрочено на/)
    expect(screen.getByTestId('my-hw-count')).toHaveTextContent('просрочено: 1')
  })

  it('«Перейти к ДЗ» ведёт в урок сразу на вкладку ДЗ', () => {
    state.rows = [hw({ homework_id: 'd', status: 'returned', topic_id: 'topic-42' })]
    renderPage()

    expect(within(screen.getByTestId('my-hw-row')).getByRole('link', { name: 'Перейти к ДЗ' }))
      .toHaveAttribute('href', '/my-course/g1/topic/topic-42?tab=homework')
  })

  it('без адреса кнопки «Перейти к ДЗ», ведущей в никуда, нет', () => {
    // Достижимо, только если карта групп не доехала.
    state.groups = new Map()
    state.rows = [hw({ homework_id: 'd', status: 'not_started' })]
    renderPage()

    expect(screen.getByTestId('my-hw-row').querySelector('a')).toBeNull()
  })

  it('курс-черновик (is_active = false) ссылку не отнимает', () => {
    // §123.3: признак витрины не решает, откроется ли тема.
    state.courses = []
    state.rows = [hw({ homework_id: 'd', status: 'not_started', topic_id: 'topic-9' })]
    renderPage()

    expect(screen.getByTestId('hw-open')).toHaveAttribute('href', '/my-course/g1/topic/topic-9?tab=homework')
  })

  it('ДЗ с автопроверкой — карточкой: пилюля «автопроверка», «осталось N из M задач»', () => {
    state.rows = [{ ...hw({ homework_id: 'ac', status: 'not_started' }), autocheck: true, left: 3, total: 10 } as never]
    renderPage()

    const row = screen.getByTestId('my-hw-row')
    expect(within(row).getByText('автопроверка')).toBeInTheDocument()
    expect(within(row).getByTestId('hw-left')).toHaveTextContent('осталось 3 из 10 задач')
  })

  it('уроки и школа — отдельными группами, счётчики сверху по всем', () => {
    state.lessonCourseIds = new Set(['c1'])
    state.rows = [
      hw({ homework_id: 'l1', status: 'not_started', course_id: 'c1' }),
      hw({ homework_id: 's1', status: 'submitted', course_id: 'c2', course_title: 'Физика 11А' }),
    ]
    renderPage()

    const groups = screen.getAllByTestId('my-hw-group')
    expect(groups.map(g => g.querySelector('h2')?.textContent)).toEqual(['Уроки', 'Школа'])
    expect(screen.getByTestId('my-hw-stats').textContent).toBe('1Сдать1На проверке0Принято')
  })

  it('когда заданий нет вовсе — понятная заглушка, а не пустой экран', () => {
    renderPage()
    expect(screen.getByText('Домашних заданий пока нет')).toBeInTheDocument()
  })

  it('когда всё сдано — говорит об этом, а не «нужно сделать: 0»', () => {
    state.rows = [hw({ homework_id: 'e', status: 'accepted' })]
    renderPage()
    expect(screen.getByTestId('my-hw-count')).toHaveTextContent('Всё сдано')
  })

  it('при одном курсе ряда переключателей нет вовсе', () => {
    state.courses = [TWO_COURSES[0]]
    state.rows = [hw({ homework_id: 'a', status: 'not_started' })]
    renderPage()

    expect(screen.queryByTestId('my-hw-course-filter')).not.toBeInTheDocument()
  })

  it('ряд переключателей показывает все курсы ученика со счётчиками, включая пустой', () => {
    state.courses = TWO_COURSES
    state.rows = [
      hw({ homework_id: 'a', status: 'not_started' }),
      hw({ homework_id: 'b', status: 'accepted' }),
    ]
    renderPage()

    // Курс без заданий обязан быть в ряду с нулём: иначе он выглядит потерянным.
    expect(screen.getByRole('button', { name: /Все\s*2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Физика ЕГЭ\s*2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Математика ЕГЭ\s*0/ })).toBeInTheDocument()
  })

  it('выбор курса отбирает список и запоминается в адресе страницы', () => {
    state.courses = TWO_COURSES
    state.rows = [
      hw({ homework_id: 'a', status: 'not_started', topic_title: 'Кинематика' }),
      hw({ homework_id: 'b', status: 'not_started', course_id: 'c2', course_title: 'Математика ЕГЭ', topic_title: 'Логарифмы' }),
    ]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Математика ЕГЭ/ }))

    expect(screen.getByTestId('address')).toHaveTextContent('/my-homework?course=c2')
    expect(screen.getByText('Логарифмы')).toBeInTheDocument()
    expect(screen.queryByText('Кинематика')).not.toBeInTheDocument()
  })

  it('курс из адреса применяется сразу при открытии страницы', () => {
    state.courses = TWO_COURSES
    state.rows = [
      hw({ homework_id: 'a', status: 'not_started', topic_title: 'Кинематика' }),
      hw({ homework_id: 'b', status: 'not_started', course_id: 'c2', course_title: 'Математика ЕГЭ', topic_title: 'Логарифмы' }),
    ]
    renderPage('/my-homework?course=c2')

    expect(screen.getByText('Логарифмы')).toBeInTheDocument()
    expect(screen.queryByText('Кинематика')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Математика ЕГЭ/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('отбор не пересортировывает: просроченное остаётся выше близкого срока', () => {
    state.courses = TWO_COURSES
    state.rows = [
      hw({ homework_id: 'soon', status: 'not_started', due_at: '2026-08-20', topic_title: 'Позже' }),
      hw({ homework_id: 'late', status: 'not_started', due_at: '2026-07-01', is_overdue: true, topic_title: 'Раньше' }),
    ]
    renderPage('/my-homework?course=c1')

    const titles = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(titles).toEqual(['Раньше', 'Позже'])
  })

  it('пустой результат отбора говорит словами, а не пустым экраном', () => {
    state.courses = TWO_COURSES
    state.rows = [hw({ homework_id: 'a', status: 'not_started' })]
    renderPage('/my-homework?course=c2')

    expect(screen.getByTestId('my-hw-empty-filter')).toHaveTextContent('По этому курсу заданий нет')
    // И выход обратно: заглушка не должна быть тупиком.
    fireEvent.click(screen.getByRole('button', { name: 'Показать все курсы' }))
    expect(screen.getByText('Кинематика')).toBeInTheDocument()
    expect(screen.getByTestId('address')).toHaveTextContent('/my-homework')
  })

  it('курс из адреса, которого у ученика нет, не прячет список', () => {
    // Ссылка со стороны или выбывшая группа: показать всё честнее, чем
    // навсегда застрять в отборе, которому нечего показать.
    state.courses = TWO_COURSES
    state.rows = [hw({ homework_id: 'a', status: 'not_started' })]
    renderPage('/my-homework?course=c-неизвестный')

    expect(screen.getByText('Кинематика')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Все/ })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('MyTopicHomeworkPage — список по кнопке главной (§254)', () => {
  const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA') }
  const todoHw = (id: string, dueAt: string | null, courseId = 'c1'): TodoHomework => ({
    homeworkId: id, homeworkTitle: 'ДЗ', topicId: `t-${id}`, topicTitle: `Т ${id}`, courseId, courseTitle: 'Физика ЕГЭ',
    groupId: 'g1', dueAt, topic: { is_open: true, available_from: null },
  })

  beforeEach(() => {
    state.courses = TWO_COURSES
    state.groups = new Map([['c1', 'g1'], ['c2', 'g2']])
    state.loading = false
    state.error = null
    state.noStudentRecord = false
    state.rows = [
      hw({ homework_id: 'o1', topic_title: 'Давняя', status: 'not_started', is_overdue: true }),
      hw({ homework_id: 'o2', topic_title: 'Свежая просрочка', status: 'not_started', is_overdue: true }),
      hw({ homework_id: 's1', topic_title: 'Скоро', status: 'not_started' }),
      hw({ homework_id: 'l1', topic_title: 'В мае', status: 'not_started', course_id: 'c2' }),
      hw({ homework_id: 'x1', topic_title: 'Сдано', status: 'submitted' }),
    ]
    todoState.todo = buildStudentTodo({
      rawAttempts: [], tests: [], verdicts: [],
      homework: [todoHw('o2', day(-2)), todoHw('o1', day(-30)), todoHw('s1', day(5)), todoHw('l1', day(200), 'c2')],
    })
    useStudentTodoMock.mockClear()
  })

  it('?show=overdue — только просроченное, самое давнее сверху; путь ко всем заданиям', () => {
    renderPage('/my-homework?show=overdue')
    const list = screen.getByTestId('my-hw-show')
    expect(within(list).getByRole('heading', { level: 1 })).toHaveTextContent('Просрочено')
    expect(within(list).getAllByTestId('my-hw-row').map(r => r.querySelector('h3')?.textContent)).toEqual(['Давняя', 'Свежая просрочка'])
    expect(screen.getByTestId('my-hw-count')).toHaveTextContent('Работ: 2')
    fireEvent.click(screen.getByTestId('my-hw-show-all'))
    expect(screen.queryByTestId('my-hw-show')).toBeNull()
    expect(screen.getByTestId('address')).toHaveTextContent(/^\/my-homework$/)
    expect(screen.getAllByTestId('my-hw-row')).toHaveLength(5)
  })

  it('?show=soon и ?show=later — окно 14 дней и всё, что позже', () => {
    renderPage('/my-homework?show=soon')
    expect(within(screen.getByTestId('my-hw-show')).getAllByTestId('my-hw-row').map(r => r.querySelector('h3')?.textContent)).toEqual(['Скоро'])
    expect(screen.getByTestId('my-hw-count')).toHaveTextContent('Срок в ближайшие 14 дней: 1')
  })

  it('?show=later — работы позже окна, другие курсы тоже', () => {
    renderPage('/my-homework?show=later')
    expect(within(screen.getByTestId('my-hw-show')).getAllByTestId('my-hw-row').map(r => r.querySelector('h3')?.textContent)).toEqual(['В мае'])
  })

  it('пустой список — словами и с выходом, а не голый экран', () => {
    renderPage('/my-homework?show=returned')
    expect(screen.getByTestId('my-hw-show-empty')).toHaveTextContent('В этом списке ничего не осталось')
  })

  it('отбор курса в адресе переживает «Все задания»', () => {
    renderPage('/my-homework?course=c1&show=overdue')
    expect(screen.getByTestId('my-hw-show-all')).toHaveAttribute('href', '/my-homework?course=c1')
  })

  it('без show и с чужим show — обычная страница, список дел не грузится', () => {
    renderPage('/my-homework?show=что-то')
    expect(screen.queryByTestId('my-hw-show')).toBeNull()
    expect(screen.getAllByTestId('my-hw-row')).toHaveLength(5)
    expect(useStudentTodoMock).toHaveBeenCalledWith(undefined)
    expect(useStudentTodoMock).not.toHaveBeenCalledWith('profile-1')
  })
})
