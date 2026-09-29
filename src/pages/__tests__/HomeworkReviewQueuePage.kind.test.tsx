import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { countByTab, rowsOfTab, type QueueRow, type QueueTab } from '@/lib/homeworkQueue'
import { WORK_KIND_FILTER_KEY } from '@/lib/timedWork'

/**
 * §240. В проверке работ у каждой работы плашка «ДЗ» / «Проверочная» / «КР»,
 * фильтр по типу рядом с курсом и темой (запоминается), «сдано автоматически
 * в 10:45», а у работ по времени нет «Вернуть на доработку».
 */

const state = { all: [] as QueueRow[], studentNames: {} as Record<string, string> }

vi.mock('@/hooks/useHomeworkReviewQueue', () => ({
  useHomeworkReviewQueue: (tab: QueueTab = 'submitted') => ({
    rows: rowsOfTab(state.all, tab),
    all: state.all,
    counts: countByTab(state.all),
    attemptFiles: [],
    reviews: [],
    studentNames: state.studentNames,
    loading: false,
    error: null,
    reload: vi.fn(),
    reviewAttempt: vi.fn(),
  }),
}))

vi.mock('@/components/courseProgram/AttemptAnnotationOverlay', () => ({
  AttemptAnnotationOverlay: ({ subtitle, reviewBar }: { subtitle?: string; reviewBar?: any }) => (
    <div data-testid="attempt-annotation-overlay">
      <span data-testid="overlay-subtitle">{subtitle}</span>
      <div data-testid="overlay-review-bar">
        {reviewBar?.({ publishAnnotations: async () => true, reference: null, showReference: null })}
      </div>
    </div>
  ),
  splitAnnotatableFiles: (files: any[]) => ({ annotatable: files, other: [] }),
}))

import { HomeworkReviewQueuePage } from '@/pages/HomeworkReviewQueuePage'

function row(id: string, student: string, kind: QueueRow['topicKind'], attemptOver: Record<string, unknown> = {}): QueueRow {
  return {
    attempt: {
      id, homework_id: `hw-${id}`, student_id: student, attempt_number: 1, status: 'submitted',
      submitted_at: '2026-10-02T07:41:00Z', created_at: '2026-10-02T07:00:00Z', updated_at: '2026-10-02T07:41:00Z',
      ...attemptOver,
    } as any,
    history: [],
    homeworkId: `hw-${id}`,
    homeworkTitle: 'Работа',
    gradeScale: 'five',
    dueAt: null,
    topicId: `t-${id}`,
    topicTitle: `Тема ${id}`,
    topicKind: kind,
    courseId: 'c1',
    courseTitle: 'Физика ЕГЭ 10А',
  }
}

function renderPage(url = '/homework-queue') {
  return render(<MemoryRouter initialEntries={[url]}><HomeworkReviewQueuePage /></MemoryRouter>)
}

describe('Очередь проверки: тип работы (§240)', () => {
  beforeEach(() => {
    localStorage.clear()
    state.studentNames = { s1: 'Кузнецова', s2: 'Смирнов', s3: 'Иванова', s4: 'Петров' }
    state.all = [
      row('a1', 's1', 'control'),
      row('a2', 's2', 'control', { auto_submitted: true, submitted_at: '2026-10-02T07:45:00Z' }),
      row('a3', 's3', 'check'),
      row('a4', 's4', 'lesson'),
    ]
  })

  it('у каждой работы плашка типа', () => {
    renderPage()
    const tags = screen.getAllByTestId('queue-kind-tag').map(t => t.textContent)
    expect(tags.sort()).toEqual(['КР', 'КР', 'ДЗ', 'Проверочная'].sort())
  })

  it('«сдано автоматически в 10:45» — у автосданной, и только у неё', () => {
    renderPage()
    const auto = screen.getAllByTestId('queue-auto-submitted')
    expect(auto).toHaveLength(1)
    expect(auto[0]).toHaveTextContent('сдано автоматически в 10:45')
    expect(within(auto[0].closest('li')!).getByText('Смирнов')).toBeInTheDocument()
  })

  it('фильтр по типу со счётчиками; выбор запоминается', () => {
    renderPage()
    const select = screen.getByTestId('queue-kind-filter') as HTMLSelectElement
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['Все · 4', 'ДЗ · 1', 'Проверочные · 1', 'КР · 2'])

    fireEvent.change(select, { target: { value: 'control' } })
    expect(screen.getAllByTestId('queue-attempt-card')).toHaveLength(2)
    expect(screen.queryByText('Иванова')).not.toBeInTheDocument()
    expect(localStorage.getItem(WORK_KIND_FILTER_KEY)).toBe('control')
  })

  it('запомненный фильтр применяется при следующем заходе; мусор в хранилище — «все»', () => {
    localStorage.setItem(WORK_KIND_FILTER_KEY, 'check')
    const { unmount } = renderPage()
    expect(screen.getAllByTestId('queue-attempt-card')).toHaveLength(1)
    expect(screen.getByText('Иванова')).toBeInTheDocument()
    unmount()

    localStorage.setItem(WORK_KIND_FILTER_KEY, 'exam')
    renderPage()
    expect(screen.getAllByTestId('queue-attempt-card')).toHaveLength(4)
  })

  it('переход с `?topic=` (раздел курса, §241) не прячется запомненным фильтром типа', () => {
    localStorage.setItem(WORK_KIND_FILTER_KEY, 'lesson')
    renderPage('/homework-queue?topic=t-a3')
    expect((screen.getByTestId('queue-kind-filter') as HTMLSelectElement).value).toBe('all')
    expect(localStorage.getItem(WORK_KIND_FILTER_KEY)).toBe('lesson')
  })

  it('КР: на экране проверки нет «Вернуть на доработку», в шапке — «сдано автоматически»', () => {
    renderPage()
    fireEvent.click(screen.getByText('Смирнов'))
    expect(screen.getByTestId('overlay-subtitle')).toHaveTextContent('сдано автоматически 2 октября в 10:45')
    const bar = screen.getByTestId('overlay-review-bar')
    expect(within(bar).getByTestId('review-accept-button')).toBeInTheDocument()
    expect(within(bar).queryByTestId('review-return-button')).not.toBeInTheDocument()
  })

  it('обычное ДЗ: «Вернуть на доработку» на месте', () => {
    renderPage()
    fireEvent.click(screen.getByText('Петров'))
    expect(within(screen.getByTestId('overlay-review-bar')).getByTestId('review-return-button')).toBeInTheDocument()
  })
})
