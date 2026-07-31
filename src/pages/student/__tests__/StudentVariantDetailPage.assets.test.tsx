import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mockAssignmentDetail = vi.hoisted(() => ({
    assignment: {
    id: 'assign-1',
    status: 'completed',
    started_at: '2026-07-13T09:00:00Z',
    submitted_at: '2026-07-13T10:00:00Z',
    completed_at: '2026-07-13T10:00:00Z',
    available_from: null,
    due_at: null,
    score: 0,
    max_score: 1,
    percentage: 0,
    grading_status: 'graded',
    answered_count: 1,
    correct_count: 0,
    manual_review_count: 0,
    teacher_name: 'Алексей Петров',
    variant: {
      id: 'variant-1',
      title: 'Мой вариант',
      description: null,
      subject: 'math',
      exam_type: 'ege',
      tasks_count: 1,
      source_type: 'student_self_built',
    },
    assignment: null,
  },
}))

const mockAttemptState = vi.hoisted(() => ({
  items: [{
    item_id: 'item-1',
    variant_id: 'variant-1',
    task_id: 'task-1',
    item_position: 1,
    points: 1,
    max_points: 1,
    grading_type: 'auto',
    task_ext_id: 7,
    section_id: 'sec-1',
    subject: 'Математика',
    exam_type: 'ЕГЭ',
    partial_type: null,
    statement_html: '<p><img src="DI_703.png" alt="PIC"></p>',
    has_answer: false,
    has_solution: true,
    exam_part: 2,
    source_type: 'student_self_built',
    solution_html: '<p><img src="sol.png" alt="PIC"></p>',
    solution_plan_html: null,
    grade_criteria_html: null,
    answer_html: '<p>6</p>',
    assets: [
      { id: 'a1', tex_session_id: null, kind: 'condition', storage_path: 'math-ege/1861/DI_703.png', alt: 'PIC', position: 1 },
      { id: 'a2', tex_session_id: null, kind: 'solution', storage_path: 'math-ege/1861/sol.png', alt: 'PIC', position: 2 },
    ],
  }],
  answers: { 'item-1': '42' },
  saveStates: {},
  attachments: {},
  attempt: {
    status: 'completed',
    submitted_at: '2026-07-13T10:00:00Z',
    completed_at: '2026-07-13T10:00:00Z',
    started_at: '2026-07-13T09:00:00Z',
    answered_count: 1,
    correct_count: 0,
    score: 0,
    max_score: 1,
    percentage: 0,
    grading_status: 'graded',
    manual_review_count: 0,
  },
  loading: false,
  error: null,
  startAttempt: vi.fn(),
  setAnswer: vi.fn(),
  addAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  submitVariant: vi.fn(),
  submitting: false,
  submitError: null,
  gradedAnswers: {},
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
        createSignedUrl: vi.fn(),
      }),
    },
  },
}))

vi.mock('@/hooks/useVariantAssignments', () => ({
  useStudentVariantAssignmentDetail: () => ({
    assignment: mockAssignmentDetail.assignment,
    items: [],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/hooks/useVariantAttempt', () => ({
  useVariantAttempt: () => mockAttemptState,
}))

import { StudentVariantDetailPage } from '@/pages/student/StudentVariantDetailPage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/student/variants/assign-1']}>
      <Routes>
        <Route path="/student/variants/:assignmentId" element={<StudentVariantDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('StudentVariantDetailPage asset rendering', () => {
  beforeEach(() => {
    window.location.hash = ''
    sessionStorage.clear()
    mockAssignmentDetail.assignment = {
      ...mockAssignmentDetail.assignment,
      status: 'completed',
      started_at: '2026-07-13T09:00:00Z',
      submitted_at: '2026-07-13T10:00:00Z',
      completed_at: '2026-07-13T10:00:00Z',
      teacher_name: 'Алексей Петров',
      variant: {
        ...mockAssignmentDetail.assignment.variant,
        source_type: 'student_self_built',
      },
    }
    mockAttemptState.attempt = {
      ...mockAttemptState.attempt,
      status: 'completed',
      submitted_at: '2026-07-13T10:00:00Z',
      completed_at: '2026-07-13T10:00:00Z',
      started_at: '2026-07-13T09:00:00Z',
    }
    mockAttemptState.items = [{
      item_id: 'item-1',
      variant_id: 'variant-1',
      task_id: 'task-1',
      item_position: 1,
      points: 1,
      max_points: 1,
      grading_type: 'auto',
      task_ext_id: 7,
      section_id: 'sec-1',
      subject: 'Математика',
      exam_type: 'ЕГЭ',
      partial_type: null,
      statement_html: '<p><img src="DI_703.png" alt="PIC"></p>',
      has_answer: false,
      has_solution: true,
      exam_part: 2,
      source_type: 'student_self_built',
      solution_html: '<p><img src="sol.png" alt="PIC"></p>',
      solution_plan_html: null,
      grade_criteria_html: null,
      answer_html: '<p>6</p>',
      assets: [
        { id: 'a1', tex_session_id: null, kind: 'condition', storage_path: 'math-ege/1861/DI_703.png', alt: 'PIC', position: 1 },
        { id: 'a2', tex_session_id: null, kind: 'solution', storage_path: 'math-ege/1861/sol.png', alt: 'PIC', position: 2 },
      ],
    }] as any
    mockAttemptState.answers = { 'item-1': '42' }
  })

  it('shows self-check step first and then opens full results with assets', () => {
    const scrollIntoViewMock = vi.fn()
    const scrollToMock = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock,
    })
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: scrollToMock,
    })

    renderPage()

    const imgsBefore = screen.getAllByRole('img') as HTMLImageElement[]
    // Домен задаёт VITE_ASSETS_BASE_URL (R2), см. комментарий в SelfCheckPanel.test.
    expect(imgsBefore[0].src).toContain('math-ege/1861/DI_703.png')
    expect(screen.getByText('Самопроверка второй части')).toBeInTheDocument()
    expect(screen.queryByTestId('auto-results-table')).not.toBeInTheDocument()
    expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })

    fireEvent.click(screen.getByText('Закончить'))

    expect(screen.getByTestId('auto-results-table')).toBeInTheDocument()
    expect(scrollToMock).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
    expect(screen.getByText('Тестовая часть')).toBeInTheDocument()
    expect(screen.getByText('Правильный ответ')).toBeInTheDocument()
    expect(screen.getAllByText('42').length).toBeGreaterThan(0)
    expect(screen.getByText(/Правильный ответ:/)).toBeInTheDocument()
    expect(screen.getByTestId('auto-answer-badge-item-1')).toHaveTextContent('Неверно')
    expect(screen.getByTestId('auto-answer-cell-item-1').className).toContain('bg-rose-100')
    expect(screen.getByTestId('auto-answer-row-item-1').className).toContain('bg-rose-50')
    expect(screen.getByTestId('auto-answer-corner-badge-item-1')).toHaveTextContent('Неверно')
    expect(screen.getByRole('link', { name: '7' })).toHaveAttribute('href', '#result-task-item-1')
    expect(screen.getByTestId('result-task-reveal-item-1')).toBeInTheDocument()
    expect(screen.getAllByText('Решение').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('link', { name: '7' }))
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(window.location.hash).toBe('#result-task-item-1')
    expect(screen.getByTestId('result-task-card-item-1').className).toContain('border-primary-400')

    const imgsAfter = screen.getAllByRole('img') as HTMLImageElement[]
    expect(imgsAfter[1].src).toContain('math-ege/1861/sol.png')
  })

  it('shows results on re-entry when submitted_at exists even if raw status is not_started', () => {
    mockAssignmentDetail.assignment = {
      ...mockAssignmentDetail.assignment,
      status: 'not_started',
      started_at: null,
      submitted_at: '2026-07-13T10:00:00Z',
      completed_at: null,
    } as unknown as typeof mockAssignmentDetail.assignment
    mockAttemptState.attempt = {
      ...mockAttemptState.attempt,
      status: 'not_started',
      started_at: null,
      submitted_at: '2026-07-13T10:00:00Z',
      completed_at: null,
      grading_status: 'needs_review',
    } as unknown as typeof mockAttemptState.attempt

    renderPage()

    expect(screen.getByText('Самопроверка второй части')).toBeInTheDocument()
    expect(screen.queryByText('Нажмите кнопку, чтобы начать. После начала таймер не останавливается.')).not.toBeInTheDocument()
    expect(screen.queryByText('Начать вариант')).not.toBeInTheDocument()
  })

  it('hides teacher line for self-built variants', () => {
    renderPage()
    expect(screen.queryByText(/Преподаватель:/)).not.toBeInTheDocument()
  })

  it('shows green status when the short answer is correct', () => {
    mockAttemptState.answers = { 'item-1': '6' }
    mockAttemptState.items[0].partial_type = null

    renderPage()
    fireEvent.click(screen.getByText('Закончить'))

    expect(screen.getByTestId('auto-answer-badge-item-1')).toHaveTextContent('Верно')
    expect(screen.getByTestId('auto-answer-cell-item-1').className).toContain('bg-emerald-100')
    expect(screen.getByTestId('auto-answer-row-item-1').className).toContain('bg-emerald-50')
    expect(screen.getByTestId('auto-answer-corner-badge-item-1')).toHaveTextContent('Верно')
  })

  it('shows yellow status for a partially correct physics answer', () => {
    mockAttemptState.items[0] = {
      ...mockAttemptState.items[0],
      points: 2,
      max_points: 2,
      partial_type: 'matching',
      answer_html: '<p>123</p>',
    } as any
    mockAttemptState.answers = { 'item-1': '12' }

    renderPage()
    fireEvent.click(screen.getByText('Закончить'))

    expect(screen.getByTestId('auto-answer-badge-item-1')).toHaveTextContent('Частично верно')
    expect(screen.getByTestId('auto-answer-badge-item-1')).toHaveTextContent('1/2')
    expect(screen.getByTestId('auto-answer-cell-item-1').className).toContain('bg-amber-100')
    expect(screen.getByTestId('auto-answer-row-item-1').className).toContain('bg-amber-50')
    expect(screen.getByTestId('auto-answer-corner-badge-item-1')).toHaveTextContent('Частично верно')
  })

  it('skips self-check step on re-entry after local completion', () => {
    sessionStorage.setItem('self-check-complete:assign-1', '1')

    renderPage()

    expect(screen.getByText('Вариант завершён')).toBeInTheDocument()
    expect(screen.getByTestId('auto-results-table')).toBeInTheDocument()
    expect(screen.queryByText('Самопроверка второй части')).not.toBeInTheDocument()
  })

  it('auto-starts self-built variants instead of showing the manual start screen', async () => {
    mockAssignmentDetail.assignment = {
      ...mockAssignmentDetail.assignment,
      status: 'not_started',
      started_at: null,
      submitted_at: null,
      completed_at: null,
    } as unknown as typeof mockAssignmentDetail.assignment
    mockAttemptState.attempt = {
      ...mockAttemptState.attempt,
      status: 'not_started',
      started_at: null,
      submitted_at: null,
      completed_at: null,
    } as unknown as typeof mockAttemptState.attempt
    const startAttemptSpy = vi.fn(async () => {})
    mockAttemptState.startAttempt = startAttemptSpy

    renderPage()

    await waitFor(() => expect(startAttemptSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Подготавливаем вариант')).toBeInTheDocument())
    expect(screen.queryByText('Нажмите кнопку, чтобы начать. После начала таймер не останавливается.')).not.toBeInTheDocument()
    expect(screen.queryByText('Начать вариант')).not.toBeInTheDocument()
  })

  it('scrolls to the top when the attempt transitions into the results screen', async () => {
    const scrollToMock = vi.fn()
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: scrollToMock,
    })

    mockAssignmentDetail.assignment = {
      ...mockAssignmentDetail.assignment,
      status: 'in_progress',
      started_at: '2026-07-13T09:00:00Z',
      submitted_at: null,
      completed_at: null,
    } as unknown as typeof mockAssignmentDetail.assignment
    mockAttemptState.attempt = {
      ...mockAttemptState.attempt,
      status: 'in_progress',
      started_at: '2026-07-13T09:00:00Z',
      submitted_at: null,
      completed_at: null,
      grading_status: null,
    } as unknown as typeof mockAttemptState.attempt
    mockAttemptState.items[0].exam_part = 1

    const view = renderPage()

    expect(screen.getByText('Завершить вариант')).toBeInTheDocument()
    expect(scrollToMock).not.toHaveBeenCalled()

    mockAssignmentDetail.assignment = {
      ...mockAssignmentDetail.assignment,
      status: 'completed',
      submitted_at: '2026-07-13T10:00:00Z',
      completed_at: '2026-07-13T10:00:00Z',
    } as unknown as typeof mockAssignmentDetail.assignment
    mockAttemptState.attempt = {
      ...mockAttemptState.attempt,
      status: 'completed',
      submitted_at: '2026-07-13T10:00:00Z',
      completed_at: '2026-07-13T10:00:00Z',
      grading_status: 'graded',
    } as unknown as typeof mockAttemptState.attempt

    view.rerender(
      <MemoryRouter initialEntries={['/student/variants/assign-1']}>
        <Routes>
          <Route path="/student/variants/:assignmentId" element={<StudentVariantDetailPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('auto-results-table')).toBeInTheDocument())
    expect(scrollToMock).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })
})
