import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import {
  filterHomeworkByCourse, homeworkCourseOptions, splitHomeworkBuckets,
  type TopicJournalHomework,
} from '@/lib/topicJournal'
import { myTopicHref } from '@/lib/studentTopicAccess'

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
}

vi.mock('@/hooks/useMyTopicHomework', () => ({
  useMyTopicHomework: (courseId: string | null = null) => {
    const courseOptions = homeworkCourseOptions(state.rows, state.courses)
    const activeCourseId = courseId && courseOptions.some(o => o.id === courseId) ? courseId : null
    return {
      buckets: splitHomeworkBuckets(filterHomeworkByCourse(state.rows, activeCourseId)),
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
  })

  it('показывает предстоящее ДЗ, которое ученик ещё не начинал', () => {
    // Именно этого не было видно нигде: дашборд читает только начатые попытки,
    // поэтому не начатое ДЗ для ученика не существовало.
    // Срок задаём ОТНОСИТЕЛЬНО сегодняшнего дня. Раньше здесь стояла жёсткая
    // дата и ожидание «Срок: 5 августа»; теперь карточка печатает остаток
    // словами («осталось N дней»), и с жёсткой датой тест протух бы сам —
    // сначала стал бы «просрочено», а потом менял бы число каждый день.
    // Дата без времени и по ЛОКАЛЬНОМУ календарю: dueUrgency сравнивает
    // строки YYYY-MM-DD, и ISO с временем даёт сдвиг на день в минусовых зонах.
    const due = new Date()
    due.setDate(due.getDate() + 10)
    const inTenDays = due.toLocaleDateString('en-CA')
    state.rows = [hw({ homework_id: 'a', status: 'not_started', due_at: inTenDays })]
    renderPage()

    // Заголовком карточки стала ТЕМА, а своё название ДЗ ушло в строку с
    // курсом: «Физика ЕГЭ · ДЗ по кинематике». Поэтому тему ищем целой
    // строкой, а название — по вхождению.
    expect(screen.getByText('Кинематика')).toBeInTheDocument()
    expect(screen.getByText(/ДЗ по кинематике/)).toBeInTheDocument()
    expect(screen.getByText('Не сдано')).toBeInTheDocument()
    // Строка срока собрана из иконки и текста, поэтому getByText по подстроке
    // её не находит — сверяем текст всей карточки.
    expect(screen.getByTestId('my-hw-row').textContent).toContain('осталось 10 дней')
    expect(screen.getByTestId('my-hw-count')).toHaveTextContent('Нужно сделать: 1')
  })

  it('показывает проверенную работу с оценкой и комментарием учителя', () => {
    state.rows = [hw({
      homework_id: 'b', status: 'accepted', score: 4, grade_scale: 'five',
      comment: 'Проверь знаки в третьем действии', reviewed_at: '2026-07-29T10:00:00Z',
    })]
    renderPage()

    expect(screen.getByText('Принято')).toBeInTheDocument()
    // Слово «Оценка:» из карточки убрано — балл стоит отдельной плашкой
    // справа от заголовка и печатается через formatHomeworkScore.
    expect(screen.getByText('4 / 5')).toBeInTheDocument()
    expect(screen.getByText('Проверь знаки в третьем действии')).toBeInTheDocument()
  })

  it('помечает просроченное и выносит счёт просрочек в подзаголовок', () => {
    state.rows = [hw({ homework_id: 'c', status: 'not_started', is_overdue: true, due_at: '2026-07-01T00:00:00Z' })]
    renderPage()

    expect(screen.getByText('Просрочено')).toBeInTheDocument()
    expect(screen.getByTestId('my-hw-count')).toHaveTextContent('просрочено: 1')
  })

  it('строка ведёт на тему курса, где эту работу можно сдать', () => {
    state.rows = [hw({ homework_id: 'd', status: 'returned', topic_id: 'topic-42' })]
    renderPage()

    expect(screen.getByTestId('my-hw-row').closest('a'))
      .toHaveAttribute('href', '/my-course/g1/topic/topic-42')
  })

  it('карточка — настоящая ссылка целиком: кликается вся и берётся в Tab', () => {
    // Не `div` с onClick: у ссылки есть фокус с клавиатуры, «открыть в новой
    // вкладке» и адрес в статусной строке.
    state.rows = [hw({ homework_id: 'd', status: 'not_started', topic_id: 'topic-7' })]
    renderPage()

    const row = screen.getByTestId('my-hw-row')
    expect(row.tagName).toBe('A')
    expect(row).toHaveAttribute('href', '/my-course/g1/topic/topic-7')
    // Кнопка действия лежит ВНУТРИ ссылки — кликается любая точка карточки.
    expect(row.textContent).toContain('Сдать')
  })

  it('без адреса карточка не притворяется ссылкой', () => {
    // Достижимо, только если карта групп не доехала: работу в списке ученик
    // видит через то же членство в группе, что даёт и адрес.
    state.groups = new Map()
    state.rows = [hw({ homework_id: 'd', status: 'not_started' })]
    renderPage()

    const row = screen.getByTestId('my-hw-row')
    expect(row.closest('a')).toBeNull()
    expect(row.className).not.toContain('cursor-pointer')
    expect(row.className).not.toContain('hover:')
    // И кнопки «Сдать», ведущей в никуда, тоже нет.
    expect(row.textContent).not.toContain('Сдать')
  })

  it('курс-черновик (is_active = false) ссылку не отнимает', () => {
    // §123.3: у ученика 11А оба курса были черновиками, и карточки не вели
    // никуда. Признак витрины не решает, откроется ли тема; список курсов в
    // ряду переключателей при этом собирается из строк журнала.
    state.courses = []
    state.rows = [hw({ homework_id: 'd', status: 'not_started', topic_id: 'topic-9' })]
    renderPage()

    expect(screen.getByTestId('my-hw-row')).toHaveAttribute('href', '/my-course/g1/topic/topic-9')
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
