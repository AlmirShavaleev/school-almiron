import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

/** alert() -> toast.error() + red-border/focus on the score field (no window.alert). */

type MockResult = { data: unknown; error: { message: string } | null }

const fromSpy = vi.fn()
const updateSpy = vi.fn()

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

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: toastError } }))

import { ReviewTopicSubmissionModal } from '@/components/modals/ReviewTopicSubmissionModal'

const submissionRow = {
  id: 'sub-1', student_id: 'stud-1', status: 'submitted',
  answer_text: null, file_url: null, score: null, feedback: null, submitted_at: null,
  homeworks: { title: 'ДЗ', topics: { title: 'Тема', modules: { course_id: 'course-1', title: 'Модуль' } } },
  students: { id: 'stud-1', profile_id: 'profile-1', profiles: { full_name: 'Ученик' } },
}

describe('ReviewTopicSubmissionModal — score validation no longer uses window.alert', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fromSpy.mockReset()
    updateSpy.mockReset()
    toastError.mockReset()
    fromSpy.mockImplementation((table: string) => table === 'homework_submissions' ? makeChain({ data: submissionRow, error: null }) : makeChain({ data: [], error: null }))
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { throw new Error('window.alert must not be called') })
  })

  it('an out-of-range score on "Принять" shows a toast, highlights the field, and never patches the row', async () => {
    render(<ReviewTopicSubmissionModal open submissionId="sub-1" onClose={vi.fn()} onReviewed={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Ученик')).toBeInTheDocument())

    const scoreInput = screen.getByPlaceholderText('—') as HTMLInputElement
    fireEvent.change(scoreInput, { target: { value: '150' } })
    fireEvent.click(screen.getByText('Принять'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Балл должен быть от 0 до 100'))
    expect(alertSpy).not.toHaveBeenCalled()
    expect(scoreInput.className).toContain('border-red-500')
    expect(updateSpy).not.toHaveBeenCalled()
  })
})
