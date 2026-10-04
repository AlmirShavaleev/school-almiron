/**
 * §248. Спокойный экран проверки целиком, как его собирает очередь: панель
 * одного задания справа, липкая полоса внизу, меню «…» с полной таблицей.
 *
 * Главное, что держит этот тест, — ПУТЬ записи: вердикт с клавиши или кнопки
 * уходит в `useHomeworkReviewTasks.patchRow` (тот же, что у таблицы §199), а
 * балл и «Принять · N» в нижней полосе пересчитываются из тех же строк.
 * Хуки данных подменены, разбор (аннотатор) — заглушкой с теми же пропами.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import { countByTab, rowsOfTab, type QueueRow, type QueueTab } from '@/lib/homeworkQueue'
import type { ReviewTaskPatch, ReviewTaskRow } from '@/lib/homeworkReviewTasks'

const state = { all: [] as QueueRow[] }

vi.mock('@/hooks/useHomeworkReviewQueue', () => ({
  useHomeworkReviewQueue: (tab: QueueTab = 'submitted') => ({
    rows: rowsOfTab(state.all, tab),
    all: state.all,
    counts: countByTab(state.all),
    attemptFiles: [],
    reviews: [],
    studentNames: { s1: 'Артём' },
    loading: false,
    error: null,
    reload: vi.fn(),
    reviewAttempt: vi.fn(),
  }),
}))

vi.mock('@/hooks/useQueueAiJobs', () => ({
  useQueueAiJobs: () => ({ jobs: {}, running: new Set(), runChecks: vi.fn(), reload: vi.fn() }),
}))
vi.mock('@/hooks/useReviewPresence', () => ({ useReviewPresence: () => ({ viewers: [] }) }))
vi.mock('@/hooks/useHomeworkAiCheck', () => ({
  useHomeworkAiCheck: () => ({
    job: null, findings: [], loading: false, running: false, error: null,
    runCheck: vi.fn(), markAccepted: vi.fn(), reload: vi.fn(),
  }),
}))

const row = (no: string, verdict: ReviewTaskRow['verdict']): ReviewTaskRow => ({
  id: `r${no}`, attempt_id: 'a1', no, verdict, student_answer: `x${no}`, expected_answer: `x${no}`,
  note: null, position: Number(no), updated_by: null, updated_at: '2026-09-30T00:00:00Z',
})
/** Пять заданий: 4 верно, 1 не сверено → балл 5 из 5 (не сверенное в балл не идёт). */
const START = [row('1', 'correct'), row('2', 'correct'), row('3', 'correct'), row('4', 'correct'), row('5', 'unchecked')]
const patchRow = vi.fn()

vi.mock('@/hooks/useHomeworkReviewTasks', () => ({
  useHomeworkReviewTasks: () => {
    const [rows, setRows] = useState(START)
    return {
      rows,
      loading: false,
      error: null,
      saveState: 'idle',
      addRow: vi.fn(),
      removeRow: vi.fn(),
      seedNow: vi.fn(),
      refillFromAi: vi.fn(),
      reload: vi.fn(),
      patchRow: async (id: string, patch: ReviewTaskPatch) => {
        patchRow(id, patch)
        setRows(list => list.map(item => (item.id === id ? { ...item, ...patch } : item)))
        return true
      },
    }
  },
}))

vi.mock('@/components/courseProgram/AttemptAnnotationOverlay', () => ({
  AttemptAnnotationOverlay: ({ reviewPanel, reviewBar, menuExtras, currentTaskNo }: {
    reviewPanel?: any; reviewBar?: any; currentTaskNo?: string | null
    menuExtras?: { id: string; label: string; testId?: string; onSelect: () => void }[]
  }) => (
    <div data-testid="attempt-annotation-overlay">
      <span data-testid="overlay-current-task">{currentTaskNo}</span>
      {(menuExtras ?? []).map(item => (
        <button key={item.id} type="button" data-testid={item.testId} onClick={item.onSelect}>{item.label}</button>
      ))}
      <div data-testid="overlay-review-panel">
        {reviewPanel?.({ publishAnnotations: async () => true, reference: null, showReference: null })}
      </div>
      <div data-testid="overlay-review-bar">
        {reviewBar?.({ publishAnnotations: async () => true, reference: null, showReference: null })}
      </div>
    </div>
  ),
  splitAnnotatableFiles: (files: any[]) => ({ annotatable: files, other: [] }),
}))

import { HomeworkReviewQueuePage } from '@/pages/HomeworkReviewQueuePage'

function queueRow(): QueueRow {
  return {
    attempt: {
      id: 'a1', homework_id: 'hw1', student_id: 's1', attempt_number: 1, status: 'submitted',
      submitted_at: '2026-09-28T09:00:00Z', created_at: '2026-09-28T08:00:00Z', updated_at: '2026-09-28T09:00:00Z',
    } as any,
    history: [], homeworkId: 'hw1', homeworkTitle: 'Проверочная', gradeScale: 'five', dueAt: null,
    topicId: 't1', topicTitle: 'Производная', courseId: 'c1', courseTitle: '11А',
  }
}

function openReview() {
  render(<MemoryRouter><HomeworkReviewQueuePage /></MemoryRouter>)
  fireEvent.click(screen.getByText('Артём'))
}

const accept = () => within(screen.getByTestId('overlay-review-bar')).getByTestId('review-accept-button')

describe('§248 — экран проверки в сборе', () => {
  beforeEach(() => {
    state.all = [queueRow()]
    patchRow.mockReset()
  })

  it('справа — одно задание, внизу — балл по заданиям и «Принять · 5»', () => {
    openReview()
    const panel = screen.getByTestId('overlay-review-panel')
    expect(within(panel).getByTestId('review-focus-task')).toHaveAttribute('data-no', '1')
    expect(within(panel).queryByTestId('ai-check-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('overlay-current-task')).toHaveTextContent('1')
    // §265: проверочная 5-балльная — оценка кнопкой 2–5.
    expect(screen.getByTestId('review-grade-5')).toHaveAttribute('aria-pressed', 'true')
    expect(accept()).toHaveTextContent('Принять · 5')
  })

  it('клавиша 3 пишет «неверно» через patchRow, балл и «Принять · N» пересчитываются', () => {
    openReview()
    fireEvent.keyDown(window, { key: '3' })
    expect(patchRow).toHaveBeenCalledWith('r1', { verdict: 'wrong' })
    // 3 верных из 4 сверенных = 75 % → 4.
    expect(screen.getByTestId('review-grade-4')).toHaveAttribute('aria-pressed', 'true')
    expect(accept()).toHaveTextContent('Принять · 4')
    // Курсор ушёл дальше — и фото узнало об этом.
    expect(screen.getByTestId('overlay-current-task')).toHaveTextContent('2')
  })

  it('кнопка «Частично» — тем же путём', () => {
    openReview()
    fireEvent.click(screen.getByTestId('review-focus-verdict-partial'))
    expect(patchRow).toHaveBeenCalledWith('r1', { verdict: 'partial' })
    // (3 + 0,5) / 4 = 87,5 % → 4.
    expect(accept()).toHaveTextContent('Принять · 4')
  })

  it('«Все задания таблицей» из меню — полная таблица, клавиши экрана в ней молчат', () => {
    openReview()
    fireEvent.click(screen.getByTestId('review-open-table'))
    const sheet = screen.getByTestId('review-table-sheet')
    expect(within(sheet).getByTestId('ai-check-panel')).toBeInTheDocument()
    expect(within(sheet).getByTestId('review-tasks-filters')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: '3' })
    expect(patchRow).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('review-table-sheet-close'))
    expect(screen.queryByTestId('review-table-sheet')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: '3' })
    expect(patchRow).toHaveBeenCalledWith('r1', { verdict: 'wrong' })
  })
})
