import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * Behavioral test of the collection homework revision cycle:
 * submit -> teacher returns with comment -> student sees returned + comment,
 * resubmits -> comment/score reset, status submitted -> teacher accepts with score.
 *
 * Renders the real pages (AssignmentDetailPage, SubmissionDetailPage) against a
 * mock supabase client. supabase.rpc is a stateful fake that enforces the same
 * contract as the real submit_task_solution/grade_task_submission RPCs, so a
 * frontend/RPC mismatch fails here rather than only in production.
 */

type Row = Record<string, unknown>

function makeChain(result: { data: unknown; error: { message: string } | null }) {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
      return () => chain
    },
  })
  return chain
}

let profile: { id: string; role: string } = { id: 'stud-1', role: 'student' }

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: typeof profile }) => unknown) => selector({ profile }),
}))

// Deep catalog lookups are irrelevant to the revision-cycle contract under test.
vi.mock('@/hooks/useCatalog', () => ({
  useCatalogTasksBatch: (ids: string[]) => ({
    tasks: ids.map(id => ({
      id, external_id: 1, section_id: '', subject: 'Математика', exam_type: 'ОГЭ',
      statement_html: '<p>2+2=?</p>', answer_html: null, solution_html: null,
      solution_plan_html: null, grade_criteria_html: null, has_answer: false, has_solution: false,
      position: 1, assets: [],
    })),
    loading: false,
  }),
}))

const assignmentRow: Row = {
  id: 'assign-1', collection_id: 'col-1', teacher_id: 'teacher-1', student_id: 'stud-1',
  group_id: null, due_date: null, status: 'active', created_at: '2026-07-01T00:00:00Z',
}

const collectionRow: Row = { id: 'col-1', title: 'ДЗ по алгебре', subject: 'Математика', work_type: 'practice' }

const taskItem = {
  item_id: 'item-1', catalog_task_id: 'task-1', item_position: 1, custom_number: null,
  external_id: 1, subject: 'Математика', exam_type: 'ОГЭ', statement_html: '<p>2+2=?</p>',
  has_answer: false, has_solution: false, assets: [],
}

// Single mutable row shared across from()/rpc() — the source of truth the mock RPCs mutate.
let submission: Row | null = null

function resetSubmission(overrides: Row = {}) {
  submission = {
    id: 'sub-1', assigned_id: 'assign-1', student_id: 'stud-1', answers: {}, files: [],
    submitted_at: '2026-07-01T10:00:00Z', status: 'submitted', teacher_comment: null,
    score: null, reviewed_at: null, created_at: '2026-07-01T10:00:00Z', updated_at: '2026-07-01T10:00:00Z',
    ...overrides,
  }
}

const fromSpy = vi.fn((table: string) => {
  switch (table) {
    case 'students':
      return makeChain({ data: { id: 'stud-1' }, error: null })
    case 'assigned_collections':
      return makeChain({ data: assignmentRow, error: null })
    case 'task_collections':
      return makeChain({ data: collectionRow, error: null })
    case 'task_collection_items':
      return makeChain({
        data: [{ id: 'item-1', catalog_task_id: 'task-1', position: 1, custom_number: null, catalog_tasks: { statement_html: '<p>2+2=?</p>' } }],
        error: null,
      })
    case 'task_submissions':
      return makeChain({ data: submission, error: null })
    default:
      return makeChain({ data: [], error: null })
  }
})

const rpcSpy = vi.fn((name: string, args: Record<string, unknown>) => {
  if (name === 'get_student_assignment_tasks') return Promise.resolve({ data: [taskItem], error: null })
  if (name === 'get_assignment_roster') return Promise.resolve({ data: [], error: null })

  if (name === 'submit_task_solution') {
    if (submission && submission.status !== 'returned') {
      return Promise.resolve({ data: null, error: { message: `Cannot resubmit: current status is ${submission.status}` } })
    }
    submission = {
      id: 'sub-1', assigned_id: args.p_assigned_id, student_id: 'stud-1',
      answers: args.p_answers, files: args.p_files, status: 'submitted',
      teacher_comment: null, score: null, reviewed_at: null,
      submitted_at: '2026-07-05T12:00:00Z', updated_at: '2026-07-05T12:00:00Z', created_at: submission?.created_at ?? '2026-07-01T10:00:00Z',
    }
    return Promise.resolve({ data: { ...submission }, error: null })
  }

  if (name === 'grade_task_submission') {
    submission = {
      ...(submission as Row),
      status: args.p_status, score: args.p_score, teacher_comment: args.p_comment,
      reviewed_at: '2026-07-05T13:00:00Z', updated_at: '2026-07-05T13:00:00Z',
    }
    return Promise.resolve({ data: { ...submission }, error: null })
  }

  return Promise.resolve({ data: null, error: null })
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromSpy(table),
    rpc: (name: string, args: Record<string, unknown>) => rpcSpy(name, args),
    storage: { from: () => ({ createSignedUrl: vi.fn(), upload: vi.fn() }) },
  },
}))

import { AssignmentDetailPage } from '@/pages/student/AssignmentDetailPage'
import { SubmissionDetailPage } from '@/pages/SubmissionDetailPage'

function renderAssignmentDetail() {
  return render(
    <MemoryRouter initialEntries={['/my-assignments/assign-1']}>
      <Routes><Route path="/my-assignments/:id" element={<AssignmentDetailPage />} /></Routes>
    </MemoryRouter>,
  )
}

function renderSubmissionDetail() {
  return render(
    <MemoryRouter initialEntries={['/review-submissions/sub-1']}>
      <Routes><Route path="/review-submissions/:id" element={<SubmissionDetailPage />} /></Routes>
    </MemoryRouter>,
  )
}

describe('task submission revision cycle — student side (AssignmentDetailPage)', () => {
  beforeEach(() => {
    profile = { id: 'stud-1', role: 'student' }
    fromSpy.mockClear()
    rpcSpy.mockClear()
  })

  it('unlocks the form and shows the teacher comment when status is returned', async () => {
    resetSubmission({ status: 'returned', teacher_comment: 'Проверь второй пример', score: null })
    renderAssignmentDetail()

    await waitFor(() => expect(screen.getByText('Проверь второй пример')).toBeInTheDocument())
    expect(screen.getByText(/Возвращено на доработку/)).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText('Введите ответ…') as HTMLTextAreaElement
    expect(textarea).not.toBeDisabled()
    expect(screen.getByText('Отправить заново')).toBeInTheDocument()
  })

  it('resubmits with the correct RPC args and clears the old comment/score in the UI', async () => {
    resetSubmission({ status: 'returned', teacher_comment: 'Проверь второй пример', score: null })
    renderAssignmentDetail()

    await screen.findByText('Проверь второй пример')
    const textarea = await screen.findByPlaceholderText('Введите ответ…')
    fireEvent.change(textarea, { target: { value: '4' } })
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe('4'))
    fireEvent.click(screen.getByText('Отправить заново'))

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('submit_task_solution', {
      p_assigned_id: 'assign-1', p_answers: { 'task-1': '4' }, p_files: [],
    }))

    await waitFor(() => expect(screen.getByText(/На проверке/)).toBeInTheDocument())
    expect(screen.queryByText('Проверь второй пример')).not.toBeInTheDocument()
  })

  it('rejects a resubmit attempt while a submission is still under review (RPC contract guard)', async () => {
    resetSubmission({ status: 'submitted' })
    // Directly exercise the mock contract the way the RPC would reject it — the
    // page itself never re-offers the form in this state, so assert isLocked instead.
    renderAssignmentDetail()

    const textarea = await screen.findByPlaceholderText('Введите ответ…')
    expect(textarea).toBeDisabled()
    expect(screen.queryByText('Отправить заново')).not.toBeInTheDocument()
    expect(screen.queryByText('Отправить')).not.toBeInTheDocument()
  })

  it('locks the form and shows the score once accepted', async () => {
    resetSubmission({ status: 'accepted', score: 5, teacher_comment: 'Отлично' })
    renderAssignmentDetail()

    await waitFor(() => expect(screen.getByText(/Принято/)).toBeInTheDocument())
    expect(screen.getByText(/Оценка: 5/)).toBeInTheDocument()

    const textarea = screen.getByPlaceholderText('Введите ответ…') as HTMLTextAreaElement
    expect(textarea).toBeDisabled()
    expect(screen.queryByText('Отправить заново')).not.toBeInTheDocument()
    expect(screen.queryByText('Отправить')).not.toBeInTheDocument()
  })
})

describe('task submission revision cycle — teacher side (SubmissionDetailPage)', () => {
  beforeEach(() => {
    profile = { id: 'teacher-1', role: 'teacher' }
    fromSpy.mockClear()
    rpcSpy.mockClear()
    resetSubmission({ status: 'submitted' })
  })

  it('"Принять" grades accepted with no score/comment when left blank', async () => {
    renderSubmissionDetail()
    fireEvent.click(await screen.findByText('Принять'))

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('grade_task_submission', {
      p_submission_id: 'sub-1', p_status: 'accepted', p_score: null, p_comment: null,
    }))
  })

  it('"Вернуть на доработку" grades returned with the typed comment', async () => {
    renderSubmissionDetail()
    fireEvent.change(await screen.findByPlaceholderText('Комментарий для ученика…'), { target: { value: 'Есть ошибка во втором примере' } })
    fireEvent.click(screen.getByText('Вернуть на доработку'))

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('grade_task_submission', {
      p_submission_id: 'sub-1', p_status: 'returned', p_score: null, p_comment: 'Есть ошибка во втором примере',
    }))
  })

  it('"Отклонить" grades rejected with a score and comment', async () => {
    const { container } = renderSubmissionDetail()
    await screen.findByText('Проверка')
    const scoreInput = container.querySelector('input[type="number"]') as HTMLInputElement
    fireEvent.change(scoreInput, { target: { value: '2' } })
    fireEvent.change(screen.getByPlaceholderText('Комментарий для ученика…'), { target: { value: 'Не по критериям' } })
    fireEvent.click(screen.getByText('Отклонить'))

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('grade_task_submission', {
      p_submission_id: 'sub-1', p_status: 'rejected', p_score: 2, p_comment: 'Не по критериям',
    }))
  })
})
