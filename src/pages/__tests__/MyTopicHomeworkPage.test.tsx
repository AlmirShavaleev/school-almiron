import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { TopicJournalHomework } from '@/lib/topicJournal'

const state = {
  buckets: { todo: [] as TopicJournalHomework[], awaiting: [] as TopicJournalHomework[], done: [] as TopicJournalHomework[] },
  summary: null as { hw_overdue: number } | null,
  loading: false,
  error: null as string | null,
  noStudentRecord: false,
}

vi.mock('@/hooks/useMyTopicHomework', () => ({
  useMyTopicHomework: () => ({
    ...state,
    topicLink: (row: TopicJournalHomework) => `/my-course/g1/topic/${row.topic_id}`,
    reload: vi.fn(),
  }),
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

function renderPage() {
  return render(<MemoryRouter><MyTopicHomeworkPage /></MemoryRouter>)
}

describe('MyTopicHomeworkPage — список ДЗ ученика', () => {
  beforeEach(() => {
    state.buckets = { todo: [], awaiting: [], done: [] }
    state.summary = null
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
    state.buckets.todo = [hw({ homework_id: 'a', status: 'not_started', due_at: inTenDays })]
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
    state.buckets.done = [hw({
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
    state.buckets.todo = [hw({ homework_id: 'c', status: 'not_started', is_overdue: true, due_at: '2026-07-01T00:00:00Z' })]
    state.summary = { hw_overdue: 1 }
    renderPage()

    expect(screen.getByText('Просрочено')).toBeInTheDocument()
    expect(screen.getByTestId('my-hw-count')).toHaveTextContent('просрочено: 1')
  })

  it('строка ведёт на тему курса, где эту работу можно сдать', () => {
    state.buckets.todo = [hw({ homework_id: 'd', status: 'returned', topic_id: 'topic-42' })]
    renderPage()

    expect(screen.getByTestId('my-hw-row').closest('a'))
      .toHaveAttribute('href', '/my-course/g1/topic/topic-42')
  })

  it('когда заданий нет вовсе — понятная заглушка, а не пустой экран', () => {
    renderPage()
    expect(screen.getByText('Домашних заданий пока нет')).toBeInTheDocument()
  })

  it('когда всё сдано — говорит об этом, а не «нужно сделать: 0»', () => {
    state.buckets.done = [hw({ homework_id: 'e', status: 'accepted' })]
    renderPage()
    expect(screen.getByTestId('my-hw-count')).toHaveTextContent('Всё сдано')
  })
})
