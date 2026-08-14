import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { JoinTeacherPage } from '@/pages/JoinTeacherPage'
import { useAuthStore } from '@/store/authStore'

/**
 * Ссылка регистрации у преподавателя болела тем же, чем ученическое
 * приглашение: сохранённая навсегда, она перехватывала главную. Здесь
 * сторожится вторая половина лечения — страница не взводит ловушку тому, кому
 * ссылка не адресована, и даёт ему выход, кроме «смени аккаунт».
 */
const submitTeacherJoinRequest = vi.fn()
const signOut = vi.fn()

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ signOut }) }))

vi.mock('@/lib/teacherJoinRequests', () => {
  class TeacherJoinRequestError extends Error {
    kind: string
    constructor(kind: string, message: string) {
      super(message)
      this.kind = kind
    }
  }
  return {
    submitTeacherJoinRequest: (token: string) => submitTeacherJoinRequest(token),
    TeacherJoinRequestError,
  }
})

const KEY = 'teacher-join-link-pending'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/jt/tok-1']}>
      <Routes>
        <Route path="/jt/:token" element={<JoinTeacherPage />} />
        <Route path="/dashboard" element={<div>dashboard-stub</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function login(role: string | null) {
  useAuthStore.setState({
    user: { id: 'u1', email: 'a@a.com' },
    profile: role ? { id: 'u1', email: 'a@a.com', full_name: 'A', role, created_at: '', updated_at: '' } : null,
    loading: false,
  } as any)
}

describe('JoinTeacherPage', () => {
  beforeEach(() => {
    submitTeacherJoinRequest.mockReset()
    submitTeacherJoinRequest.mockResolvedValue(undefined)
    signOut.mockReset()
    useAuthStore.setState({ user: null, profile: null, loading: false } as any)
    localStorage.clear()
  })

  it('ученику ссылка сохраняется — без этого не пережить подтверждение почты', async () => {
    login('student')
    renderPage()

    expect(JSON.parse(localStorage.getItem(KEY) || '{}')).toMatchObject({ token: 'tok-1' })
  })

  it('персоналу ссылка НЕ сохраняется: иначе она перехватит ему главную', () => {
    login('teacher')
    renderPage()

    expect(localStorage.getItem(KEY)).toBeNull()
    expect(submitTeacherJoinRequest).not.toHaveBeenCalled()
  })

  it('«Это не моя ссылка» вычищает запись и ведёт в кабинет, не трогая аккаунт', async () => {
    localStorage.setItem(KEY, JSON.stringify({ token: 'tok-1', savedAt: Date.now() }))
    login('owner')
    renderPage()

    fireEvent.click(screen.getByTestId('join-teacher-not-mine'))

    expect(await screen.findByText('dashboard-stub')).toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('«Войти в другой аккаунт» по-прежнему работает', async () => {
    login('teacher')
    renderPage()

    fireEvent.click(screen.getByText('Войти в другой аккаунт'))
    await waitFor(() => expect(signOut).toHaveBeenCalled())
  })
})
