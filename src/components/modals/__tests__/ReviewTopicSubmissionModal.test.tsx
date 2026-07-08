import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

type MockResult = { data: unknown; error: { message: string } | null }

const fromSpy = vi.fn()

function makeChain(result: MockResult | Promise<MockResult>) {
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

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string; role: string } }) => unknown) =>
    selector({ profile: { id: 'p1', role: 'teacher' } }),
}))

vi.mock('@/utils/notify', () => ({ notifyHomeworkChecked: vi.fn() }))

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))

vi.mock('@/components/SubmissionReviewer', () => ({
  default: ({ onPublishComplete }: { onPublishComplete?: (ok: boolean) => void }) => (
    <div>
      <button onClick={() => onPublishComplete?.(true)}>fake-publish-success</button>
      <button onClick={() => onPublishComplete?.(false)}>fake-publish-fail</button>
    </div>
  ),
}))

import { ReviewTopicSubmissionModal } from '@/components/modals/ReviewTopicSubmissionModal'

const submissionRow = {
  id: 'sub-1', student_id: 'stud-1', status: 'submitted',
  answer_text: null, file_url: null, score: null, feedback: null, submitted_at: null,
  homeworks: { title: 'ДЗ', topics: { title: 'Тема', modules: { course_id: 'course-1', title: 'Модуль' } } },
  students: { id: 'stud-1', profile_id: 'profile-1', profiles: { full_name: 'Ученик' } },
}

const submissionWithFile = { ...submissionRow, file_url: 'submissions/x/y.pdf' }

describe('ReviewTopicSubmissionModal load error handling', () => {
  beforeEach(() => {
    fromSpy.mockReset()
  })

  it('shows an error message with a Close button when the main submission query fails, instead of an infinite spinner', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'homework_submissions') {
        return makeChain({ data: null, error: { message: 'Could not find a relationship between homeworks and groups' } })
      }
      return makeChain({ data: [], error: null })
    })

    const onClose = vi.fn()
    render(<ReviewTopicSubmissionModal open submissionId="sub-1" onClose={onClose} onReviewed={vi.fn()} />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not find a relationship')
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Закрыть'))
    expect(onClose).toHaveBeenCalled()
  })

  it('still renders the submission when the group lookup fails, falling back to — for the group name', async () => {
    fromSpy.mockImplementation((table: string) => {
      if (table === 'homework_submissions') return makeChain({ data: submissionRow, error: null })
      if (table === 'group_students') return makeChain({ data: null, error: { message: 'group lookup failed' } })
      return makeChain({ data: [], error: null })
    })

    render(<ReviewTopicSubmissionModal open submissionId="sub-1" onClose={vi.fn()} onReviewed={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Ученик')).toBeInTheDocument())
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ReviewTopicSubmissionModal auto-close on publish', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    toastSuccess.mockReset()
    fromSpy.mockImplementation((table: string) => {
      if (table === 'homework_submissions') return makeChain({ data: submissionWithFile, error: null })
      return makeChain({ data: [], error: null })
    })
  })

  it('closes and shows a success toast when the reviewer reports a full publish success', async () => {
    const onClose = vi.fn()
    render(<ReviewTopicSubmissionModal open submissionId="sub-1" onClose={onClose} onReviewed={vi.fn()} />)

    const btn = await screen.findByText('fake-publish-success')
    fireEvent.click(btn)

    expect(onClose).toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalledWith('Проверка опубликована')
  })

  it('stays open without a toast when the reviewer reports a failed publish', async () => {
    const onClose = vi.fn()
    render(<ReviewTopicSubmissionModal open submissionId="sub-1" onClose={onClose} onReviewed={vi.fn()} />)

    const btn = await screen.findByText('fake-publish-fail')
    fireEvent.click(btn)

    expect(onClose).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

describe('ReviewTopicSubmissionModal — no-file submissions also close and toast via the footer button', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    toastSuccess.mockReset()
    fromSpy.mockImplementation((table: string) => {
      if (table === 'homework_submissions') return makeChain({ data: submissionRow, error: null })
      return makeChain({ data: [], error: null })
    })
  })

  it('the footer "Принять" button is shown (no viewer) and closes the modal with a toast on success', async () => {
    const onClose = vi.fn()
    render(<ReviewTopicSubmissionModal open submissionId="sub-1" onClose={onClose} onReviewed={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Ученик')).toBeInTheDocument())
    expect(screen.queryByText('fake-publish-success')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Принять'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith('Проверка опубликована')
  })
})
