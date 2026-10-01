/**
 * §252. Экран проверки в сборе: галочка «Показать ученику N пометок ИИ» над
 * вердиктом, список «Пометки ИИ, которые увидит ученик» в колонке заданий и
 * перенос находок при «Принять» / «Вернуть».
 *
 * Хуки данных подменены, разбор (аннотатор) — заглушкой: она отдаёт
 * `publishAnnotations` и запоминает, с чем её позвали. Сам перенос в
 * `annotation_sets` проверяет `SubmissionReviewer.aiMarks.test.tsx`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import { countByTab, rowsOfTab, type QueueRow, type QueueTab } from '@/lib/homeworkQueue'
import type { ReviewTaskPatch, ReviewTaskRow } from '@/lib/homeworkReviewTasks'
import type { AiFindingRow } from '@/lib/aiHomeworkCheck'

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn(), warning: vi.fn(), saved: vi.fn() } }))

const order: string[] = []
const state = { all: [] as QueueRow[], publishOk: true }
const reviewAttempt = vi.fn(async (..._args: unknown[]) => { order.push('verdict') })
const publish = vi.fn(async (..._args: unknown[]) => { order.push('publish'); return state.publishOk })
const markAccepted = vi.fn(async () => {})

vi.mock('@/hooks/useHomeworkReviewQueue', () => ({
  useHomeworkReviewQueue: (tab: QueueTab = 'submitted') => ({
    rows: rowsOfTab(state.all, tab),
    all: state.all,
    counts: countByTab(state.all),
    attemptFiles: [{ id: 'file-1', attempt_id: 'a1', storage_path: 'a1/photo.jpg', file_name: 'photo.jpg' }],
    reviews: [],
    studentNames: { s1: 'Артём' },
    loading: false,
    error: null,
    reload: vi.fn(),
    reviewAttempt,
  }),
}))
vi.mock('@/hooks/useQueueAiJobs', () => ({
  useQueueAiJobs: () => ({ jobs: {}, running: new Set(), runChecks: vi.fn(), reload: vi.fn() }),
}))
vi.mock('@/hooks/useReviewPresence', () => ({ useReviewPresence: () => ({ viewers: [] }) }))

const finding = (id: string, task: string | null, text: string, position: number): AiFindingRow => ({
  id, job_id: 'job-1', file_id: 'file-1', page: 1, rect_x: 0.1, rect_y: 0.1 * position, rect_w: 0.3, rect_h: 0.05,
  category: 'calc', text, position, task,
})
const FINDINGS = [
  finding('f1', '1', 'Знак у второго слагаемого', 1),
  finding('f2', '2', 'Ответ не упрощён', 2),
  finding('f3', '3', 'Потерян множитель 2', 3),
  finding('f5', '5', 'Не доведено до ответа', 5),
]
let findings: AiFindingRow[] = FINDINGS
vi.mock('@/hooks/useHomeworkAiCheck', () => ({
  useHomeworkAiCheck: () => ({
    job: { id: 'job-1', status: 'done', accepted_at: null, summary: null, tasks: null },
    findings, loading: false, running: false, error: null,
    runCheck: vi.fn(), markAccepted, reload: vi.fn(),
  }),
}))

const row = (no: string, verdict: ReviewTaskRow['verdict']): ReviewTaskRow => ({
  id: `r${no}`, attempt_id: 'a1', no, verdict, student_answer: `x${no}`, expected_answer: `x${no}`,
  note: null, position: Number(no), updated_by: null, updated_at: '2026-09-30T00:00:00Z',
})
/** 1 неверно, 2 верно, 3 частично, 4 верно, 5 не решено. */
let START: ReviewTaskRow[] = []
vi.mock('@/hooks/useHomeworkReviewTasks', () => ({
  useHomeworkReviewTasks: () => {
    const [rows, setRows] = useState(START)
    return {
      rows, loading: false, error: null, saveState: 'idle',
      addRow: vi.fn(), removeRow: vi.fn(), seedNow: vi.fn(), refillFromAi: vi.fn(), reload: vi.fn(),
      patchRow: async (id: string, patch: ReviewTaskPatch) => {
        setRows(list => list.map(item => (item.id === id ? { ...item, ...patch } : item)))
        return true
      },
    }
  },
}))

vi.mock('@/components/courseProgram/AttemptAnnotationOverlay', () => ({
  AttemptAnnotationOverlay: ({ reviewPanel, reviewBar, highlightGhostIds }: {
    reviewPanel?: any; reviewBar?: any; highlightGhostIds?: string[] | null
  }) => (
    <div data-testid="attempt-annotation-overlay">
      <span data-testid="overlay-highlight">{(highlightGhostIds ?? []).join(',')}</span>
      <div data-testid="overlay-review-panel">
        {reviewPanel?.({ publishAnnotations: publish, reference: null, showReference: null })}
      </div>
      <div data-testid="overlay-review-bar">
        {reviewBar?.({ publishAnnotations: publish, reference: null, showReference: null })}
      </div>
    </div>
  ),
  splitAnnotatableFiles: (files: any[]) => ({ annotatable: files, other: [] }),
}))

import { HomeworkReviewQueuePage } from '@/pages/HomeworkReviewQueuePage'

function queueRow(topicKind: QueueRow['topicKind'] = 'lesson'): QueueRow {
  return {
    attempt: {
      id: 'a1', homework_id: 'hw1', student_id: 's1', attempt_number: 1, status: 'submitted',
      submitted_at: '2026-09-28T09:00:00Z', created_at: '2026-09-28T08:00:00Z', updated_at: '2026-09-28T09:00:00Z',
    } as any,
    history: [], homeworkId: 'hw1', homeworkTitle: 'Проверочная', gradeScale: 'five', dueAt: null,
    topicId: 't1', topicTitle: 'Производная', courseId: 'c1', courseTitle: '11А', topicKind,
  }
}

function openReview() {
  render(<MemoryRouter><HomeworkReviewQueuePage /></MemoryRouter>)
  fireEvent.click(screen.getByText('Артём'))
}

const bar = () => screen.getByTestId('overlay-review-bar')
const label = () => screen.getByTestId('ai-marks-label').textContent
const takenIds = (call: unknown[]) => ((call[1] as { takeFindings?: { sourceId: string }[] } | undefined)?.takeFindings ?? []).map(r => r.sourceId)

describe('§252 — пометки ИИ уходят ученику при вердикте', () => {
  beforeEach(() => {
    state.all = [queueRow()]
    state.publishOk = true
    findings = FINDINGS
    START = [row('1', 'wrong'), row('2', 'correct'), row('3', 'partial'), row('4', 'correct'), row('5', 'unsolved')]
    order.length = 0
    reviewAttempt.mockClear()
    publish.mockClear()
    markAccepted.mockClear()
    toastSuccess.mockReset()
  })

  it('галочка включена сразу; уходят «неверно», «частично», «не решено», «верно» — серым', () => {
    openReview()
    expect(screen.getByTestId('ai-marks-checkbox')).toBeChecked()
    expect(label()).toBe('Показать ученику 3 пометки ИИ (№1, №3, №5)')
    const list = screen.getByTestId('ai-marks-list')
    expect(within(list).getAllByTestId('ai-marks-item').map(li => li.dataset.findingId)).toEqual(['f1', 'f3', 'f5'])
    const dropped = within(list).getByTestId('ai-marks-dropped')
    expect(dropped).toHaveAttribute('data-finding-id', 'f2')
    expect(dropped).toHaveTextContent('Не уйдёт: вы отметили «верно»')
  })

  it('вердикт по заданию поменяли — число и номера пересчитаны', () => {
    openReview()
    fireEvent.click(screen.getAllByTestId('review-focus-cell').find(cell => cell.dataset.no === '2')!)
    fireEvent.click(screen.getByTestId('review-focus-verdict-wrong'))
    expect(label()).toBe('Показать ученику 4 пометки ИИ (№1, №2, №3, №5)')
    fireEvent.click(screen.getByTestId('review-focus-verdict-correct'))
    expect(label()).toBe('Показать ученику 3 пометки ИИ (№1, №3, №5)')
  })

  it('крестик убирает находку (она остаётся в списке, её можно вернуть) — и она не уходит', async () => {
    openReview()
    const item = () => screen.getAllByTestId('ai-marks-item').find(li => li.dataset.findingId === 'f3')!
    fireEvent.click(within(item()).getByTestId('ai-marks-remove'))
    expect(item()).toHaveAttribute('data-state', 'removed')
    expect(label()).toBe('Показать ученику 2 пометки ИИ (№1, №5)')
    fireEvent.click(within(item()).getByTestId('ai-marks-restore'))
    expect(label()).toBe('Показать ученику 3 пометки ИИ (№1, №3, №5)')
    fireEvent.click(within(item()).getByTestId('ai-marks-remove'))

    fireEvent.click(within(bar()).getByTestId('review-accept-button'))
    await waitFor(() => expect(reviewAttempt).toHaveBeenCalled())
    expect(takenIds(publish.mock.calls[0])).toEqual(['f1', 'f5'])
  })

  it('«Принять» с галочкой: сначала перенос (рамки учителя с заданием), потом вердикт, тост с числом пометок', async () => {
    openReview()
    fireEvent.click(within(bar()).getByTestId('review-accept-button'))
    await waitFor(() => expect(reviewAttempt).toHaveBeenCalled())
    expect(order).toEqual(['publish', 'verdict'])
    const [status, options] = publish.mock.calls[0] as [string, { takeFindings: any[] }]
    expect(status).toBe('checked')
    expect(options.takeFindings).toEqual([
      expect.objectContaining({ sourceId: 'f1', jobId: 'job-1', task: '1', filePath: 'a1/photo.jpg', page: 1, text: 'Знак у второго слагаемого', category: 'calc' }),
      expect.objectContaining({ sourceId: 'f3', task: '3' }),
      expect.objectContaining({ sourceId: 'f5', task: '5' }),
    ])
    expect(reviewAttempt.mock.calls[0][1]).toBe('accepted')
    expect(markAccepted).toHaveBeenCalledWith('job-1')
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/^Принято · \d+\. Ученику ушла работа, пометок на фото: 3$/))
  })

  it('галочку сняли — ничего не переносится, вердикт как раньше', async () => {
    openReview()
    fireEvent.click(screen.getByTestId('ai-marks-checkbox'))
    expect(screen.getByTestId('ai-marks-list')).toHaveTextContent('Галочка «Показать ученику» снята')
    fireEvent.click(within(bar()).getByTestId('review-accept-button'))
    await waitFor(() => expect(reviewAttempt).toHaveBeenCalled())
    expect(publish.mock.calls[0]).toEqual(['checked', undefined])
    expect(markAccepted).not.toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/пометок на фото: 0$/))
  })

  it('перенос упал — вердикт не ставится, форма с ошибкой остаётся', async () => {
    state.publishOk = false
    openReview()
    fireEvent.click(within(bar()).getByTestId('review-accept-button'))
    expect(await within(bar()).findByText(/Не удалось перенести пометки ИИ на фото — вердикт не сохранён/)).toBeInTheDocument()
    expect(reviewAttempt).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(screen.getByTestId('attempt-annotation-overlay')).toBeInTheDocument()
    // Повтор, когда сеть вернулась, — та же пачка (дубли отсекает аннотатор).
    state.publishOk = true
    fireEvent.click(within(bar()).getByTestId('review-accept-button'))
    await waitFor(() => expect(reviewAttempt).toHaveBeenCalled())
    expect(takenIds(publish.mock.calls[1])).toEqual(['f1', 'f3', 'f5'])
  })

  it('«Вернуть на доработку» тоже переносит', async () => {
    openReview()
    fireEvent.click(within(bar()).getByTestId('review-comment-edit'))
    fireEvent.change(within(bar()).getByTestId('review-comment-input'), { target: { value: 'Исправь 1 и 3' } })
    fireEvent.click(within(bar()).getByTestId('review-return-button'))
    await waitFor(() => expect(reviewAttempt).toHaveBeenCalled())
    expect(publish.mock.calls[0][0]).toBe('revision')
    expect(takenIds(publish.mock.calls[0])).toEqual(['f1', 'f3', 'f5'])
    expect(reviewAttempt.mock.calls[0][1]).toBe('returned_for_revision')
    expect(toastSuccess).toHaveBeenCalledWith('Возвращено на доработку. Ученику ушла работа, пометок на фото: 3')
  })

  it('работа по времени (§240): «Вернуть» нет, «Принять» переносит так же', async () => {
    state.all = [queueRow('check')]
    openReview()
    expect(within(bar()).queryByTestId('review-return-button')).not.toBeInTheDocument()
    expect(label()).toBe('Показать ученику 3 пометки ИИ (№1, №3, №5)')
    fireEvent.click(within(bar()).getByTestId('review-accept-button'))
    await waitFor(() => expect(reviewAttempt).toHaveBeenCalled())
    expect(takenIds(publish.mock.calls[0])).toEqual(['f1', 'f3', 'f5'])
  })

  it('«посмотреть на фото» подсвечивает ровно те находки, что уйдут; «скрыть подсветку» — снимает', () => {
    openReview()
    expect(screen.getByTestId('overlay-highlight')).toHaveTextContent(/^$/)
    fireEvent.click(screen.getByTestId('ai-marks-look'))
    expect(screen.getByTestId('overlay-highlight')).toHaveTextContent('f1,f3,f5')
    expect(screen.getByTestId('ai-marks-look')).toHaveTextContent('скрыть подсветку')
    fireEvent.click(screen.getByTestId('ai-marks-look'))
    expect(screen.getByTestId('overlay-highlight')).toHaveTextContent(/^$/)
  })

  it('подходящих находок нет — строки над вердиктом нет', () => {
    findings = [finding('f2', '2', 'Ответ не упрощён', 2), finding('f4', '4', 'Мелочь', 4)]
    openReview()
    expect(screen.queryByTestId('ai-marks-toggle')).not.toBeInTheDocument()
    // Список честно говорит, почему ничего не уйдёт.
    expect(screen.getAllByTestId('ai-marks-dropped')).toHaveLength(2)
  })
})
