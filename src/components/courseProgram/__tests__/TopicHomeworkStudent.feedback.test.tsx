import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'
import type { TopicHomeworkAttemptRow, TopicHomeworkAttemptStatus, TopicHomeworkReviewRow } from '@/lib/topicHomework'

/**
 * §239. Разбор в ученическом блоке ДЗ: у какой попытки он стоит, куда ведёт
 * «Вся страница →» (просмотр сразу на нужной странице и рамке), «Прошлые
 * попытки» строками и переход к авторскому решению.
 */

let attempts: TopicHomeworkAttemptRow[] = []
let reviews: TopicHomeworkReviewRow[] = []
let taskRows: ReviewTaskRow[] = []
const startAttempt = vi.fn()

vi.mock('@/hooks/useTopicHomework', () => ({
  useTopicHomework: () => ({
    homework: { id: 'hw1', topic_id: 't1', title: 'ДЗ по кинематике', instructions: null, is_published: true, created_by: 'teacher', due_at: null, grade_scale: 'five', created_at: '', updated_at: '' },
    files: [], attempts, reviews, loading: false, error: null,
    attemptFiles: attempts.flatMap(a => [1, 2].map(n => ({ id: `${a.id}-f${n}`, attempt_id: a.id, storage_path: `${a.id}/photo-${n}.jpg`, file_name: `IMG_${n}.jpg`, mime_type: 'image/jpeg', size_bytes: 1, position: n, created_at: '' }))),
    startAttempt, uploadAttemptFiles: vi.fn(), removeAttemptFile: vi.fn(), reorderAttemptFiles: vi.fn(), submitAttempt: vi.fn(),
  }),
}))
vi.mock('@/hooks/useHomeworkReviewTasks', () => ({ useReviewTasksOfAttempts: () => taskRows }))
vi.mock('@/hooks/useAttemptNotes', () => ({ useAttemptNotes: () => () => [] }))
vi.mock('@/hooks/useSignedPdf', () => ({ loadSignedPdf: () => Promise.reject(new Error('нет')) }))
vi.mock('@/lib/storage', () => ({
  extractStoragePath: (p: string) => p,
  getSignedFileUrl: async (_b: string, p: string) => `blob://${p}`,
}))

function chain(table: string) {
  const c: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
  c.then = (f: (v: unknown) => unknown) => {
    const data = table === 'annotation_sets'
      ? [
          { attempt_id: 'att-2', file_path: 'att-2/photo-1.jpg', page: 1, status: 'published', data: { objects: [
            { id: 'm1', type: 'region', category: 'error', task: '3', text: 'Задача 3: знак', rect: { x: 0.1, y: 0.3, w: 0.5, h: 0.1 } },
          ] } },
          { attempt_id: 'att-2', file_path: 'att-2/photo-2.jpg', page: 1, status: 'published', data: { objects: [
            { id: 'm2', type: 'region', category: 'inaccuracy', text: 'Задача 7: нет графика', rect: { x: 0.1, y: 0.4, w: 0.5, h: 0.1 } },
          ] } },
        ]
      : []
    return Promise.resolve({ data, error: null }).then(f)
  }
  return c
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => chain(table) } }))

// Просмотр страницы — подменён: здесь важно, С ЧЕМ его открыли.
vi.mock('@/components/courseProgram/AttemptAnnotationOverlay', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/courseProgram/AttemptAnnotationOverlay')>()
  return {
    ...actual,
    AttemptAnnotationOverlay: (props: { attemptId: string; initialPage?: number | null; initialRegionId?: string | null }) => (
      <div
        data-testid="overlay-probe"
        data-attempt={props.attemptId}
        data-page={String(props.initialPage ?? '')}
        data-region={String(props.initialRegionId ?? '')}
      />
    ),
  }
})

import { TopicHomeworkStudent } from '@/components/courseProgram/TopicHomeworkStudent'

const attempt = (n: number, status: TopicHomeworkAttemptStatus): TopicHomeworkAttemptRow => ({
  id: `att-${n}`, homework_id: 'hw1', student_id: 'stu', attempt_number: n, status,
  submitted_at: status === 'draft' ? null : `2026-09-1${n}T06:30:00Z`, created_at: '', updated_at: '',
})
const review = (attemptId: string, decision: TopicHomeworkReviewRow['decision'], comment: string, score: number | null = null): TopicHomeworkReviewRow => ({
  id: `r-${attemptId}`, attempt_id: attemptId, reviewer_id: 'teacher', decision, comment, score, created_at: '2026-09-15T10:00:00Z',
})
const row = (attemptId: string, no: string, verdict: ReviewTaskRow['verdict'], expected: string): ReviewTaskRow => ({
  id: `${attemptId}-${no}`, attempt_id: attemptId, no, verdict, student_answer: '1', expected_answer: expected, note: null,
  position: Number(no) * 10, updated_by: null, updated_at: '',
})

beforeEach(() => {
  attempts = [attempt(1, 'returned_for_revision'), attempt(2, 'returned_for_revision')]
  reviews = [review('att-1', 'returned_for_revision', 'Досдай задачи 7 и 9'), review('att-2', 'returned_for_revision', 'Задачи 3 и 7 — знак')]
  taskRows = [
    row('att-1', '3', 'wrong', 'СЕКРЕТ-1'),
    row('att-2', '3', 'wrong', 'СЕКРЕТ-2'), row('att-2', '7', 'partial', '18 м'),
  ]
  startAttempt.mockReset().mockResolvedValue('att-new')
})

describe('ДЗ ученику — разбор проверенной попытки (§239)', () => {
  it('разбор стоит у последней проверенной; прошлые — строками', () => {
    render(<TopicHomeworkStudent topicId="t1" />)
    const feedback = screen.getByTestId('attempt-feedback')
    expect(feedback).toHaveTextContent('Попытка №2')
    const rows = screen.getAllByTestId('hw-history-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Попытка №1')
    // Свёрнуто: комментарий старой попытки не виден, пока строку не раскрыли.
    expect(screen.queryByText('Досдай задачи 7 и 9')).not.toBeInTheDocument()
    fireEvent.click(within(rows[0]).getByRole('button'))
    expect(screen.getByText('Досдай задачи 7 и 9')).toBeInTheDocument()
  })

  it('верный ответ не выдаёт и раскрытая прошлая попытка на доработке', () => {
    render(<TopicHomeworkStudent topicId="t1" />)
    fireEvent.click(within(screen.getByTestId('hw-history-row')).getByRole('button'))
    expect(screen.getByTestId('student-review-tasks')).toBeInTheDocument()
    expect(screen.queryByText('СЕКРЕТ-1')).not.toBeInTheDocument()
    expect(screen.queryByText('СЕКРЕТ-2')).not.toBeInTheDocument()
  })

  it('«Вся страница →» открывает просмотр этой попытки на странице и рамке задания', async () => {
    render(<TopicHomeworkStudent topicId="t1" />)
    const card7 = await waitFor(() => {
      const card = screen.getAllByTestId('feedback-task').find(c => c.getAttribute('data-no') === '7')!
      within(card).getByTestId('feedback-open-page')
      return card
    })
    fireEvent.click(within(card7).getByTestId('feedback-open-page'))
    const probe = screen.getByTestId('overlay-probe')
    expect(probe).toHaveAttribute('data-attempt', 'att-2')
    expect(probe).toHaveAttribute('data-page', '2')
    expect(probe).toHaveAttribute('data-region', 'm2')
  })

  it('миниатюра открывает просмотр на своей странице без рамки', async () => {
    render(<TopicHomeworkStudent topicId="t1" />)
    const thumbs = await screen.findAllByTestId('feedback-page-thumb')
    fireEvent.click(thumbs[0])
    expect(screen.getByTestId('overlay-probe')).toHaveAttribute('data-page', '1')
    expect(screen.getByTestId('overlay-probe')).toHaveAttribute('data-region', '')
  })

  it('после отправки новой попытки разбор уходит: ждём проверки, прошлые — строками', () => {
    attempts = [...attempts, attempt(3, 'submitted')]
    render(<TopicHomeworkStudent topicId="t1" />)
    expect(screen.queryByTestId('attempt-feedback')).not.toBeInTheDocument()
    expect(screen.getByText(/ждёт проверки/)).toBeInTheDocument()
    expect(screen.getByText('История попыток')).toBeInTheDocument()
    expect(screen.getAllByTestId('hw-history-row')).toHaveLength(3)
  })

  it('принято и решение открыто — переход к авторскому решению', () => {
    attempts = [attempt(1, 'returned_for_revision'), attempt(2, 'accepted')]
    reviews = [review('att-2', 'accepted', 'Молодец', 5)]
    const onOpenSolution = vi.fn()
    render(<TopicHomeworkStudent topicId="t1" solution={{ unlocked: true, hasSolution: true }} onOpenSolution={onOpenSolution} />)
    expect(screen.getByTestId('feedback-score')).toHaveTextContent('5из 5')
    fireEvent.click(screen.getByTestId('feedback-solution'))
    expect(onOpenSolution).toHaveBeenCalledTimes(1)
  })

  it('решение ещё закрыто — строки «Авторское решение» нет', () => {
    attempts = [attempt(2, 'accepted')]
    reviews = [review('att-2', 'accepted', 'Молодец', 5)]
    render(<TopicHomeworkStudent topicId="t1" solution={{ unlocked: false, hasSolution: true }} onOpenSolution={vi.fn()} />)
    expect(screen.queryByTestId('feedback-solution')).not.toBeInTheDocument()
  })
})
