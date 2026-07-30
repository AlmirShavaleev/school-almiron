import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { QueueRow } from '@/lib/homeworkQueue'

const state = {
  rows: [] as QueueRow[],
  attemptFiles: [] as any[],
  studentNames: {} as Record<string, string>,
  loading: false,
  error: null as string | null,
}
const reviewAttempt = vi.fn()

vi.mock('@/hooks/useHomeworkReviewQueue', () => ({
  useHomeworkReviewQueue: () => ({ ...state, reload: vi.fn(), reviewAttempt }),
}))

// Аннотатор тянет pdfjs — в этом тесте нас интересует только то, ЧТО открылось.
vi.mock('@/components/courseProgram/AttemptAnnotationOverlay', () => ({
  AttemptAnnotationOverlay: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div data-testid="attempt-annotation-overlay">
      <span>{title}</span>
      <span>{subtitle}</span>
    </div>
  ),
  splitAnnotatableFiles: (files: any[]) => ({ annotatable: files, other: [] }),
}))

import { HomeworkReviewQueuePage } from '@/pages/HomeworkReviewQueuePage'

function queueRow(over: Partial<QueueRow> = {}, attemptOver: Record<string, unknown> = {}): QueueRow {
  return {
    attempt: {
      id: 'a1', homework_id: 'hw1', student_id: 's1', attempt_number: 1,
      status: 'submitted', submitted_at: '2026-07-28T20:40:00Z',
      created_at: '2026-07-28T20:00:00Z', updated_at: '2026-07-28T20:40:00Z',
      ...attemptOver,
    } as any,
    homeworkId: 'hw1',
    homeworkTitle: 'Домашнее задание',
    gradeScale: 'five',
    dueAt: null,
    topicId: 't1',
    topicTitle: 'Новая тема1',
    courseId: 'c1',
    courseTitle: 'Тестовый курс',
    ...over,
  }
}

describe('HomeworkReviewQueuePage — список только для выбора работы', () => {
  beforeEach(() => {
    state.rows = []
    state.attemptFiles = []
    state.studentNames = { s1: 'Ученик' }
    state.loading = false
    state.error = null
    reviewAttempt.mockReset()
  })

  it('в списке нет формы вердикта — ни комментария, ни балла, ни кнопок', () => {
    // Владелец: «зачем вот здесь столько ненужного. Я должен видеть кто сдал
    // ДЗ, когда, просрочил ли он его — то есть только действительно важные
    // моменты, а потом проваливаясь внутрь я уже отмечаю ошибки».
    state.rows = [queueRow()]
    render(<HomeworkReviewQueuePage />)

    expect(screen.queryByTestId('review-comment-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-score-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-accept-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-return-button')).not.toBeInTheDocument()
  })

  it('показывает кто сдал, что и когда', () => {
    state.rows = [queueRow()]
    render(<HomeworkReviewQueuePage />)

    expect(screen.getByText('Ученик')).toBeInTheDocument()
    expect(screen.getByText('Новая тема1 · Домашнее задание')).toBeInTheDocument()
    expect(screen.getByText(/Сдано 28 июля/)).toBeInTheDocument()
  })

  it('отмечает просроченную сдачу и выносит счёт в подзаголовок', () => {
    state.rows = [queueRow({ dueAt: '2026-07-25T00:00:00Z' })]
    render(<HomeworkReviewQueuePage />)

    expect(screen.getByTestId('queue-late-badge')).toBeInTheDocument()
    expect(screen.getByTestId('queue-attempt-card')).toHaveAttribute('data-late', 'true')
    expect(screen.getByTestId('queue-count')).toHaveTextContent('просрочено: 1')
  })

  it('сданное в срок не помечается просроченным', () => {
    state.rows = [queueRow({ dueAt: '2026-08-10T00:00:00Z' })]
    render(<HomeworkReviewQueuePage />)

    expect(screen.queryByTestId('queue-late-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('queue-count')).not.toHaveTextContent('просрочено')
  })

  it('клик по строке открывает разбор этой работы', () => {
    state.rows = [queueRow({ dueAt: '2026-07-25T00:00:00Z' })]
    render(<HomeworkReviewQueuePage />)

    expect(screen.queryByTestId('attempt-annotation-overlay')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('queue-attempt-card'))

    const overlay = screen.getByTestId('attempt-annotation-overlay')
    expect(overlay).toBeInTheDocument()
    // В шапке разбора — работа, от кого, тема, и отметка об опоздании.
    expect(overlay).toHaveTextContent('Домашнее задание')
    expect(overlay).toHaveTextContent('Ученик · Новая тема1 · сдано с опозданием')
  })

  it('повторную попытку помечает номером, первую — нет', () => {
    state.rows = [queueRow({}, { attempt_number: 2 })]
    render(<HomeworkReviewQueuePage />)
    expect(screen.getByText('попытка №2')).toBeInTheDocument()
  })
})
