import type { Session, User } from '@supabase/supabase-js'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MyHomeworksV2Page } from '@/pages/student/MyHomeworksV2Page'
import { useAuthStore } from '@/store/authStore'
import type { Profile } from '@/types'

vi.mock('@/hooks/useMyHomeworkAssignments', () => ({
  useMyHomeworkAssignments: () => ({
    rows: [{ assignment_id: 'fixture-assignment-a', course_id: 'fixture-course', category: 'to_do', template_title: 'Fixture homework', effective_due_at: '2026-12-01', group_name: 'Fixture class' }],
    loading: false, error: null, reload: vi.fn(),
  }),
}))
vi.mock('@/hooks/useHomeworkAttemptV2', () => ({
  useHomeworkAttemptV2: () => ({ submitAttempt: vi.fn(), submitting: false, error: null }),
}))

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
