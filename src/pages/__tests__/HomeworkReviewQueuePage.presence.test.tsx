import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { QueueRow } from '@/lib/homeworkQueue'
import type { PresenceMeta } from '@/lib/reviewPresence'

/**
 * Мягкая защита от двойной проверки (решение владельца 2026-07-30):
 * в очереди видно «Смотрит: Имя», а если работа уже открыта коллегой —
 * второй заходит на чтение и может выйти из него осознанно.
 *
 * Тесты работают с уже разобранным списком присутствующих: сам разбор
 * состояния канала проверяется в reviewPresence.test.ts, здесь — что список
 * доезжает до строки очереди и до разбора.
 */

const state = {
  rows: [] as QueueRow[],
  attemptFiles: [] as any[],
  studentNames: {} as Record<string, string>,
  loading: false,
  error: null as string | null,
}
const presence = { viewers: [] as PresenceMeta[] }
const presenceArgs = vi.fn()

vi.mock('@/hooks/useHomeworkReviewQueue', () => ({
  useHomeworkReviewQueue: () => ({
    ...state,
    all: state.rows,
    counts: { submitted: state.rows.length, returned_for_revision: 0, accepted: 0 },
    reviews: [],
    reload: vi.fn(),
    reviewAttempt: vi.fn(),
  }),
}))

vi.mock('@/hooks/useReviewPresence', () => ({
  useReviewPresence: (args: unknown) => {
    presenceArgs(args)
    return presence
  },
}))

// Аннотатор тянет pdfjs. Подменяем его заглушкой, которая ПОКАЗЫВАЕТ то, что
// проверяем: режим открытия и кнопку выхода из чтения.
vi.mock('@/components/courseProgram/AttemptAnnotationOverlay', () => ({
  AttemptAnnotationOverlay: ({
    locked,
    onForceEdit,
  }: {
    locked?: boolean
    onForceEdit?: () => void
  }) => (
    <div data-testid="attempt-annotation-overlay" data-locked={locked ? 'true' : 'false'}>
      {locked && (
        <button type="button" data-testid="presence-force-edit" onClick={onForceEdit}>
          Всё равно редактировать
        </button>
      )}
    </div>
  ),
  splitAnnotatableFiles: (files: any[]) => ({ annotatable: files, other: [] }),
}))

import { HomeworkReviewQueuePage } from '@/pages/HomeworkReviewQueuePage'

function queueRow(attemptId: string, courseId = 'c1'): QueueRow {
  return {
    attempt: {
      id: attemptId, homework_id: 'hw1', student_id: 's1', attempt_number: 1,
      status: 'submitted', submitted_at: '2026-07-28T20:40:00Z',
      created_at: '2026-07-28T20:00:00Z', updated_at: '2026-07-28T20:40:00Z',
    } as any,
    homeworkId: 'hw1',
    homeworkTitle: 'Домашнее задание',
    gradeScale: 'five',
    dueAt: null,
    topicId: 't1',
    topicTitle: 'Новая тема1',
    courseId,
    courseTitle: 'Тестовый курс',
  }
}

const ANNA: PresenceMeta = { profileId: 'p-anna', name: 'Аня', attemptId: 'a1' }

/** Разбор открывает кнопка с именем ученика внутри строки, а не сама `<li>`. */
function openRow(index = 0) {
  fireEvent.click(screen.getAllByText('Ученик')[index])
}

describe('Очередь проверок — кто сейчас смотрит работу', () => {
  beforeEach(() => {
    state.rows = []
    state.attemptFiles = []
    state.studentNames = { s1: 'Ученик' }
    state.loading = false
    state.error = null
    presence.viewers = []
    presenceArgs.mockReset()
  })

  it('на занятой строке показывает имя, на свободной — ничего', () => {
    state.rows = [queueRow('a1'), queueRow('a2')]
    presence.viewers = [ANNA]
    render(<HomeworkReviewQueuePage />)

    const badges = screen.getAllByTestId('queue-viewer-badge')
    expect(badges).toHaveLength(1)
    // На плашке — «Проверяется», имя коллеги в подсказке: в строке место одно,
    // и длинный список имён её ломал.
    expect(badges[0]).toHaveTextContent('Проверяется')
    expect(badges[0]).toHaveAttribute('title', 'Смотрит: Аня')
  })

  it('без присутствующих бейджа нет', () => {
    state.rows = [queueRow('a1')]
    render(<HomeworkReviewQueuePage />)
    expect(screen.queryByTestId('queue-viewer-badge')).not.toBeInTheDocument()
  })

  it('подписывается на курсы своих строк и сообщает открытую работу', () => {
    state.rows = [queueRow('a1', 'c1'), queueRow('a2', 'c2')]
    render(<HomeworkReviewQueuePage />)

    expect(presenceArgs).toHaveBeenCalledWith({ courseIds: ['c1', 'c2'], attemptId: null })

    openRow(0)
    expect(presenceArgs).toHaveBeenLastCalledWith({ courseIds: ['c1', 'c2'], attemptId: 'a1' })
  })

  it('работу, которую уже смотрят, открывает только на чтение', () => {
    state.rows = [queueRow('a1')]
    presence.viewers = [ANNA]
    render(<HomeworkReviewQueuePage />)

    openRow()
    expect(screen.getByTestId('attempt-annotation-overlay')).toHaveAttribute('data-locked', 'true')
  })

  it('свободную работу открывает сразу на редактирование', () => {
    state.rows = [queueRow('a1')]
    presence.viewers = [{ ...ANNA, attemptId: 'a2' }]
    render(<HomeworkReviewQueuePage />)

    openRow()
    expect(screen.getByTestId('attempt-annotation-overlay')).toHaveAttribute('data-locked', 'false')
  })

  it('«Всё равно редактировать» снимает режим чтения', () => {
    state.rows = [queueRow('a1')]
    presence.viewers = [ANNA]
    render(<HomeworkReviewQueuePage />)

    openRow()
    fireEvent.click(screen.getByTestId('presence-force-edit'))

    expect(screen.getByTestId('attempt-annotation-overlay')).toHaveAttribute('data-locked', 'false')
  })

  it('коллега, зашедший ПОСЛЕ открытия, не выбивает в режим чтения', () => {
    // Это и есть причина снимать locked один раз: иначе тот, кто уже рисует
    // рамки, терял бы редактирование от чужого любопытства.
    state.rows = [queueRow('a1')]
    const { rerender } = render(<HomeworkReviewQueuePage />)

    openRow()
    expect(screen.getByTestId('attempt-annotation-overlay')).toHaveAttribute('data-locked', 'false')

    presence.viewers = [ANNA]
    rerender(<HomeworkReviewQueuePage />)

    expect(screen.getByTestId('attempt-annotation-overlay')).toHaveAttribute('data-locked', 'false')
  })
})
