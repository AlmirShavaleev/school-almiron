import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

/**
 * RTL parity coverage for StudentReviewPage ahead of the modal removal
 * (ReviewTopicSubmissionModal/.scoreValidation/.bodyLock tests die with the
 * modals) — same score-validation + wheel-safety contract, on the page.
 */

type MockResult = { data: unknown; error: { message: string } | null }

const fromSpy = vi.fn()
const updateSpy = vi.fn()
let groupStudentsCalls = 0
const publishTriggerSpy = vi.fn()
let submissionFilesRows: any[] = []

function makeChain(result: MockResult | Promise<MockResult>) {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'update') return (...args: unknown[]) => { updateSpy(...args); return chain }
      if (prop === 'then') {
        const p = Promise.resolve(result)
        return p.then.bind(p)
      }
      return () => chain
    },
  })
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string; role: string } }) => unknown) =>
    selector({ profile: { id: 'p1', role: 'teacher' } }),
}))

vi.mock('@/utils/notify', () => ({ notifyHomeworkChecked: vi.fn() }))

const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { success: toastSuccess, error: toastError } }))

vi.mock('@/components/SubmissionReviewer', () => ({
  default: ({
    footer,
    fitWidth,
    header,
    className,
    readOnly,
    annotationVisibility,
    filePaths,
    onPublish,
    onPublishComplete,
  }: {
    footer?: React.ReactNode | ((context: { publishing: boolean; published: boolean; triggerPublish: () => void }) => React.ReactNode)
    fitWidth?: boolean
    header?: React.ReactNode
    className?: string
    readOnly?: boolean
    annotationVisibility?: 'all' | 'published'
    filePaths?: string[]
    onPublish?: () => Promise<boolean | void>
    onPublishComplete?: (success: boolean) => void
  }) => {
    const triggerPublish = async () => {
      publishTriggerSpy()
      const ok = await onPublish?.()
      onPublishComplete?.(ok !== false)
    }
    const footerNode = typeof footer === 'function'
      ? footer({ publishing: false, published: false, triggerPublish: () => { void triggerPublish() } })
      : footer
    return (
      <div data-testid="fake-reviewer" data-fit-width={fitWidth ? 'yes' : 'default'} className={className}>
        <div data-testid="fake-reviewer-flags" data-read-only={readOnly ? 'yes' : 'no'} data-annotation-visibility={annotationVisibility ?? 'default'} data-file-count={String(filePaths?.length ?? 0)} />
        {header ? <div data-testid="fake-reviewer-header">{header}</div> : null}
        <button type="button" onClick={() => { void triggerPublish() }}>Fake toolbar publish</button>
        <div data-testid="fake-comment-scroll-area">fake reviewer</div>
        {footerNode ? <div data-testid="fake-reviewer-document-footer">{footerNode}</div> : null}
      </div>
    )
  },
}))

import { StudentReviewPage } from '@/pages/StudentReviewPage'

const hwRow = { id: 'hw-1', title: 'ДЗ', max_score: 100 }

const groupStudentRow = { student_id: 'student-1', students: { id: 'student-1', profile_id: 'profile-1', profiles: { full_name: 'Ученик' } } }
const siblingsRows = [{ student_id: 'student-1', students: { profiles: { full_name: 'Ученик' } } }]

function submissionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1', status: 'submitted', answer_text: null, file_url: null,
    score: null, feedback: null, submitted_at: null,
    ...overrides,
  }
}

function mockTables(sub: ReturnType<typeof submissionRow>) {
  groupStudentsCalls = 0
  fromSpy.mockImplementation((table: string) => {
    if (table === 'teachers') return makeChain({ data: { id: 'teacher-1' }, error: null })
    if (table === 'homeworks') return makeChain({ data: hwRow, error: null })
    if (table === 'homework_submissions') return makeChain({ data: sub, error: null })
    if (table === 'homework_submission_files') return makeChain({ data: submissionFilesRows, error: null })
    if (table === 'group_students') {
      groupStudentsCalls++
      // 1st call: single row (student lookup for this group). 2nd call: sibling list.
      return groupStudentsCalls % 2 === 1
        ? makeChain({ data: groupStudentRow, error: null })
        : makeChain({ data: siblingsRows, error: null })
    }
    return makeChain({ data: [], error: null })
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/homeworks/hw-1/review/group-1/student-1']}>
      <Routes>
        <Route path="/inbox" element={<div>queue page</div>} />
        <Route path="/homeworks/:id/review/:groupId/:studentId" element={<StudentReviewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderPageFromQueue() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/homeworks/hw-1/review/group-1/student-1', state: { from: 'queue' } }]}>
      <Routes>
        <Route path="/inbox" element={<div>queue page</div>} />
        <Route path="/homeworks/:id/review/:groupId/:studentId" element={<StudentReviewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('StudentReviewPage — score validation (no window.alert)', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    updateSpy.mockReset()
    publishTriggerSpy.mockReset()
    toastError.mockReset()
    toastSuccess.mockReset()
    submissionFilesRows = []
    mockTables(submissionRow())
  })

  it('an out-of-range score on "Принять" shows a toast, highlights the field, and never patches the row', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { throw new Error('window.alert must not be called') })
    renderPage()

    await waitFor(() => expect(screen.getByText('Ученик')).toBeInTheDocument())

    const scoreInput = screen.getByPlaceholderText('—') as HTMLInputElement
    fireEvent.change(scoreInput, { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: /Принять/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Введите балл от 0 до 100'))
    expect(alertSpy).not.toHaveBeenCalled()
    expect(scoreInput.className).toContain('border-red-500')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('a valid score on "Принять" saves and shows a success toast', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Ученик')).toBeInTheDocument())

    const scoreInput = screen.getByPlaceholderText('—') as HTMLInputElement
    fireEvent.change(scoreInput, { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: /Принять/ }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
    expect(updateSpy.mock.calls[0][0]).toMatchObject({ score: 85, status: 'checked' })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Проверка опубликована'))
  })
})

describe('StudentReviewPage — wheel over the reviewer comment area', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    updateSpy.mockReset()
    publishTriggerSpy.mockReset()
    toastError.mockReset()
    toastSuccess.mockReset()
    submissionFilesRows = []
    mockTables(submissionRow({ file_url: 'submissions/x/y.pdf' }))
  })

  it('does not crash the page or trigger navigation away from the review', async () => {
    renderPage()

    const scrollArea = await screen.findByTestId('fake-comment-scroll-area')
    fireEvent.wheel(scrollArea, { deltaY: 500 })
    fireEvent.wheel(scrollArea, { deltaY: -500 })

    // Page is still the review page, still showing the student — a wheel
    // event never unmounts/navigates/breaks it.
    expect(screen.getByText('Ученик')).toBeInTheDocument()
    expect(screen.getByTestId('fake-comment-scroll-area')).toBeInTheDocument()
  })

  it('uses the full-width continuous-review layout with a grading card at the end of the document flow', async () => {
    const { container } = renderPage()

    await waitFor(() => expect(screen.getByTestId('fake-reviewer')).toBeInTheDocument())
    const root = screen.getByTestId('student-review-page')
    expect(root.className).not.toContain('max-w-')

    const reviewer = screen.getByTestId('fake-reviewer')
    expect(reviewer.className).toContain('h-full')
    expect(screen.getByTestId('fake-reviewer-header')).toContainElement(screen.getByRole('button', { name: /Назад/ }))

    const footer = screen.getByTestId('fake-reviewer-document-footer')
    expect(footer).toContainElement(screen.getByRole('button', { name: /На доработку/ }))
    expect(footer).toContainElement(screen.getByPlaceholderText('—'))
    expect(footer).toContainElement(screen.getByPlaceholderText('Что сделано хорошо, что нужно исправить…'))
    expect(screen.getByTestId('student-review-grading-card')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="fake-reviewer-document-footer"]')).not.toBeNull()
  })

  it('uses the viewer publish path from the grading card instead of direct save', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByTestId('fake-reviewer')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('—'), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: /Опубликовать проверку/ }))

    await waitFor(() => expect(publishTriggerSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toMatchObject({ score: 85, status: 'checked' })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Проверка опубликована'))
  })

  it('blocks the grading-card publish path on an invalid score before any save happens', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByTestId('fake-reviewer')).toBeInTheDocument())
    const scoreInput = screen.getByPlaceholderText('—') as HTMLInputElement
    fireEvent.change(scoreInput, { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: /Опубликовать проверку/ }))

    await waitFor(() => expect(publishTriggerSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Введите балл от 0 до 100'))
    expect(scoreInput.className).toContain('border-red-500')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('returns to the queue after publish when opened from the queue', async () => {
    renderPageFromQueue()

    await waitFor(() => expect(screen.getByTestId('fake-reviewer')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('—'), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: /Опубликовать проверку/ }))

    await waitFor(() => expect(screen.getByText('queue page')).toBeInTheDocument())
  })

  it('keeps the old post-publish behavior without queue state', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByTestId('fake-reviewer')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('—'), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: /Опубликовать проверку/ }))

    await waitFor(() => expect(screen.queryByText('queue page')).not.toBeInTheDocument())
    expect(publishTriggerSpy).toHaveBeenCalled()
  })

  it('shows an attempt switcher only when there is history and opens older attempts as teacher read-only without grading controls', async () => {
    submissionFilesRows = [
      { submission_id: 'sub-1', storage_path: 'submissions/x/attempt-1.pdf', mime_type: 'application/pdf', position: 1, attempt_number: 1 },
      { submission_id: 'sub-1', storage_path: 'submissions/x/attempt-2.pdf', mime_type: 'application/pdf', position: 1, attempt_number: 2 },
    ]
    mockTables(submissionRow({ file_url: 'submissions/x/current.pdf' }))
    renderPage()

    const select = await screen.findByTestId('student-review-attempt-select')
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Текущая' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Попытка 1' })).toBeInTheDocument()

    fireEvent.change(select, { target: { value: '1' } })

    await waitFor(() => expect(screen.getByTestId('fake-reviewer-flags')).toHaveAttribute('data-read-only', 'yes'))
    expect(screen.getByTestId('fake-reviewer-flags')).toHaveAttribute('data-annotation-visibility', 'all')
    expect(screen.getByTestId('fake-reviewer-flags')).toHaveAttribute('data-file-count', '1')
    expect(screen.queryByTestId('student-review-grading-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Опубликовать проверку/ })).not.toBeInTheDocument()
  })
})
