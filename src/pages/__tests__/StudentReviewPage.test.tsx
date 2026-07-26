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
const reviewerRenderSpy = vi.fn()
let submissionFilesRows: any[] = []
let pendingQueueItemsMock: any[] = []
const pendingQueueLoaderSpy = vi.fn()
const queuePathSpy = vi.fn((item: any) => item.source === 'task_collection' ? `/review-submissions/${item.submissionId}` : `/homeworks/${item.homework.id}/review/${item.group.id}/${item.student.id}`)

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
vi.mock('@/lib/pendingQueue', () => ({
  loadPendingQueueItems: (...args: unknown[]) => {
    pendingQueueLoaderSpy(...args)
    return Promise.resolve(pendingQueueItemsMock)
  },
  resolveNextQueueItem: (items: any[], current: { submissionId: string; source: string } | null) => {
    if (!items.length) return null
    if (!current) return items[0]
    const index = items.findIndex(item => item.submissionId === current.submissionId && item.source === current.source)
    if (index === -1) return items[0]
    return items[index + 1] ?? null
  },
  getQueueItemReviewPath: (item: any) => queuePathSpy(item),
}))

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
    reviewerRenderSpy()
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
    reviewerRenderSpy.mockReset()
    toastError.mockReset()
    toastSuccess.mockReset()
    pendingQueueLoaderSpy.mockReset()
    queuePathSpy.mockClear()
    submissionFilesRows = []
    pendingQueueItemsMock = []
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
    pendingQueueItemsMock = []
    renderPage()

    await waitFor(() => expect(screen.getByText('Ученик')).toBeInTheDocument())

    const scoreInput = screen.getByPlaceholderText('—') as HTMLInputElement
    fireEvent.change(scoreInput, { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: /Принять/ }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
    expect(updateSpy.mock.calls[0][0]).toMatchObject({ score: 85, status: 'checked' })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Всё проверено'))
  })

  it('treats an update with no returned row as failure and does not show success', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'teachers') return makeChain({ data: { id: 'teacher-1' }, error: null })
      if (table === 'homeworks') return makeChain({ data: hwRow, error: null })
      if (table === 'homework_submissions') {
        let isUpdate = false
        const chain: any = new Proxy({}, {
          get(_target, prop) {
            if (prop === 'update') {
              return (...args: unknown[]) => {
                updateSpy(...args)
                isUpdate = true
                return chain
              }
            }
            if (prop === 'then') {
              const p = Promise.resolve(isUpdate
                ? { data: null, error: null }
                : { data: submissionRow(), error: null })
              return p.then.bind(p)
            }
            return () => chain
          },
        })
        return chain
      }
      if (table === 'homework_submission_files') return makeChain({ data: submissionFilesRows, error: null })
      if (table === 'group_students') {
        groupStudentsCalls++
        return groupStudentsCalls % 2 === 1
          ? makeChain({ data: groupStudentRow, error: null })
          : makeChain({ data: siblingsRows, error: null })
      }
      return makeChain({ data: [], error: null })
    })

    renderPage()

    await waitFor(() => expect(screen.getByText('Ученик')).toBeInTheDocument())

    const scoreInput = screen.getByPlaceholderText('—') as HTMLInputElement
    fireEvent.change(scoreInput, { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: /Принять/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Проверка не была сохранена'))
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe('StudentReviewPage — wheel over the reviewer comment area', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    updateSpy.mockReset()
    publishTriggerSpy.mockReset()
    reviewerRenderSpy.mockReset()
    toastError.mockReset()
    toastSuccess.mockReset()
    pendingQueueLoaderSpy.mockReset()
    queuePathSpy.mockClear()
    submissionFilesRows = []
    pendingQueueItemsMock = []
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
    expect(screen.getByTestId('student-review-status-pill')).toHaveTextContent('На проверке')

    const footer = screen.getByTestId('fake-reviewer-document-footer')
    expect(footer).toContainElement(screen.getByRole('button', { name: /На доработку/ }))
    expect(footer).toContainElement(screen.getByPlaceholderText('—'))
    expect(footer).toContainElement(screen.getByPlaceholderText('Что сделано хорошо, что нужно исправить…'))
    expect(screen.getByTestId('student-review-grading-card')).toBeInTheDocument()
    expect(container.querySelector('[data-testid="fake-reviewer-document-footer"]')).not.toBeNull()
  })

  it('uses the viewer publish path from the grading card instead of direct save', async () => {
    pendingQueueItemsMock = []
    renderPage()

    await waitFor(() => expect(screen.getByTestId('fake-reviewer')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('—'), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: /Опубликовать проверку/ }))

    await waitFor(() => expect(publishTriggerSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1))
    expect(updateSpy.mock.calls[0][0]).toMatchObject({ score: 85, status: 'checked' })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Всё проверено'))
  })

  it('keeps the reviewer stable while typing a score into the grading card', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByTestId('fake-reviewer')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('student-review-next-work-button')).toBeInTheDocument())
    const rendersAfterLoad = reviewerRenderSpy.mock.calls.length

    fireEvent.change(screen.getByTestId('student-review-score-input'), { target: { value: '8' } })
    fireEvent.change(screen.getByTestId('student-review-score-input'), { target: { value: '85' } })

    await waitFor(() => expect(reviewerRenderSpy.mock.calls.length).toBeLessThanOrEqual(rendersAfterLoad + 1))
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
    pendingQueueItemsMock = []
    renderPageFromQueue()

    await waitFor(() => expect(screen.getByTestId('fake-reviewer')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('—'), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: /Опубликовать проверку/ }))

    await waitFor(() => expect(screen.getByText('queue page')).toBeInTheDocument())
  })

  it('navigates to the next pending queue item after publish even without queue state', async () => {
    pendingQueueItemsMock = [
      { source: 'legacy_homework', submissionId: 'sub-1', group: { id: 'group-1' }, homework: { id: 'hw-1' } },
      { source: 'task_collection', submissionId: 'task-sub-2', group: { id: 'group-2' }, homework: { id: 'assignment-2' } },
    ]
    renderPage()

    await waitFor(() => expect(screen.getByTestId('fake-reviewer')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('—'), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: /Опубликовать проверку/ }))

    await waitFor(() => expect(queuePathSpy).toHaveBeenCalledWith(expect.objectContaining({ submissionId: 'task-sub-2', source: 'task_collection' })))
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
    expect(screen.getByTestId('student-review-historical-banner')).toHaveTextContent('Историческая попытка')
    expect(screen.queryByTestId('student-review-grading-card')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Опубликовать проверку/ })).not.toBeInTheDocument()
  })

  it('falls back to the first pending queue item when the current work is already missing from the queue', async () => {
    pendingQueueItemsMock = [
      { source: 'task_collection', submissionId: 'task-sub-9', group: { id: 'group-2' }, homework: { id: 'assignment-9' } },
    ]
    renderPage()

    await waitFor(() => expect(screen.getByTestId('student-review-next-work-button')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('student-review-next-work-button'))

    await waitFor(() => expect(queuePathSpy).toHaveBeenCalledWith(expect.objectContaining({ submissionId: 'task-sub-9' })))
  })

  it('returns to inbox with a success toast when there are no pending works left', async () => {
    pendingQueueItemsMock = []
    renderPage()

    await waitFor(() => expect(screen.getByTestId('student-review-next-work-button')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('student-review-next-work-button'))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Всё проверено'))
    await waitFor(() => expect(screen.getByText('queue page')).toBeInTheDocument())
  })

  it('hides the next-work button on already checked submissions', async () => {
    mockTables(submissionRow({ file_url: 'submissions/x/y.pdf', status: 'checked', score: 85 }))
    pendingQueueItemsMock = [{ source: 'legacy_homework', submissionId: 'other-sub', group: { id: 'group-2' }, homework: { id: 'hw-2' } }]
    renderPage()

    await waitFor(() => expect(screen.getByTestId('fake-reviewer')).toBeInTheDocument())
    expect(screen.queryByTestId('student-review-next-work-button')).not.toBeInTheDocument()
  })
})
