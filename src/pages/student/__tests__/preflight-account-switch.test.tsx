import type { Session, User } from '@supabase/supabase-js'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MyHomeworksV2Page } from '@/pages/student/MyHomeworksV2Page'
import { saveStudentDraft, studentDraftKey } from '@/lib/studentDrafts'
import { useAuthStore } from '@/store/authStore'
import type { Profile } from '@/types'

const { submitAttempt } = vi.hoisted(() => ({ submitAttempt: vi.fn() }))

vi.mock('@/hooks/useMyHomeworkAssignments', () => ({
  useMyHomeworkAssignments: () => ({
    rows: [{ assignment_id: 'fixture-assignment-a', course_id: 'fixture-course', category: 'to_do', template_title: 'Fixture homework', effective_due_at: '2026-12-01', group_name: 'Fixture class' }],
    loading: false, error: null, reload: vi.fn(),
  }),
}))
vi.mock('@/hooks/useHomeworkAttemptV2', () => ({
  useHomeworkAttemptV2: () => ({ submitAttempt, submitting: false, error: null }),
}))

afterEach(() => vi.unstubAllGlobals())

function authenticate(id: string, ready = true) {
  act(() => {
    const store = useAuthStore.getState()
    const user = { id } as User
    store.setUser(user)
    store.setSession({ user, expires_at: Date.now() / 1000 + 3600 } as Session)
    if (ready) {
      store.setProfile({ id, role: 'student' } as Profile)
      store.setLoading(false)
    }
  })
}

it('resets the modal on account switch and restores only the verified owner’s draft', () => {
  sessionStorage.clear()
  authenticate('fixture-student-a')
  render(<MyHomeworksV2Page />)
  fireEvent.click(screen.getByRole('button', { name: 'Сдать' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private synthetic draft A' } })
  authenticate('fixture-student-b', false)
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Сдать' }))
  expect(screen.queryByRole('textbox')).toBeNull()
  authenticate('fixture-student-b')
  fireEvent.click(screen.getByRole('button', { name: 'Сдать' }))
  expect(screen.getByRole('textbox')).toHaveValue('')
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private synthetic draft B' } })
  act(() => useAuthStore.getState().reset())
  expect(screen.queryByRole('textbox')).toBeNull()
  authenticate('fixture-student-a')
  fireEvent.click(screen.getByRole('button', { name: 'Сдать' }))
  expect(screen.getByRole('textbox')).toHaveValue('Private synthetic draft A')
})

it('waits for a slow IndexedDB photo restore and submits the recovered text and photo together', async () => {
  sessionStorage.clear()
  submitAttempt.mockResolvedValue(undefined)
  const photo = new File(['synthetic photo bytes'], 'solution.png', { type: 'image/png' })
  const requests: Array<{
    result?: { files: File[]; expiresAt: number }
    onsuccess?: () => void
    onerror?: () => void
  }> = []
  const store = {
    get: vi.fn(() => {
      const request: (typeof requests)[number] = {}
      requests.push(request)
      return request
    }),
    delete: vi.fn(),
    openCursor: () => ({}),
  }
  const database = {
    transaction: () => {
      const transaction: { objectStore: () => typeof store; oncomplete?: () => void } = { objectStore: () => store }
      queueMicrotask(() => transaction.oncomplete?.())
      return transaction
    },
  }
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request: { result: typeof database; onsuccess?: () => void } = { result: database }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  })
  authenticate('fixture-slow-photo')
  saveStudentDraft(
    studentDraftKey('homework-text', 'fixture-slow-photo', 'fixture-course', 'course-assignment', 'fixture-assignment-a'),
    'Synthetic answer',
  )
  render(<MyHomeworksV2Page />)
  fireEvent.click(screen.getByRole('button', { name: 'Сдать' }))
  const send = screen.getByRole('button', { name: 'Отправить' })
  expect(screen.getByRole('textbox')).toHaveValue('Synthetic answer')
  await waitFor(() => expect(requests).toHaveLength(1))
  expect(send).toBeDisabled()
  fireEvent.click(send)
  expect(submitAttempt).not.toHaveBeenCalled()

  await act(async () => requests[0].onerror?.())
  expect(send).toBeDisabled()
  expect(screen.getByRole('alert')).toHaveTextContent('Не удалось восстановить вложения')
  fireEvent.click(screen.getByRole('button', { name: 'Повторить восстановление' }))
  await waitFor(() => expect(requests).toHaveLength(2))
  expect(send).toBeDisabled()
  fireEvent.click(send)
  expect(submitAttempt).not.toHaveBeenCalled()

  await act(async () => {
    requests[1].result = { files: [photo], expiresAt: Date.now() + 60_000 }
    requests[1].onsuccess?.()
  })
  expect(screen.getByText('solution.png')).toBeInTheDocument()
  expect(send).toBeEnabled()
  fireEvent.click(send)
  await waitFor(() => expect(submitAttempt).toHaveBeenCalledExactlyOnceWith('fixture-assignment-a', 'Synthetic answer', [photo]))
})
