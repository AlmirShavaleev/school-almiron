import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LoginPage } from '@/pages/auth/LoginPage'
import { RegisterPage } from '@/pages/auth/RegisterPage'

const signIn = vi.fn()
const signUp = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    signIn: (email: string, password: string) => signIn(email, password),
    signUp: (...args: any[]) => signUp(...args),
  }),
}))

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/join/:token" element={<div>join-restored</div>} />
        <Route path="/join" element={<div>join-restored-code</div>} />
        <Route path="/dashboard" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/join/:token" element={<div>join-restored</div>} />
        <Route path="/join" element={<div>join-restored-code</div>} />
        <Route path="/login" element={<div>login-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Invite-aware auth flow', () => {
  beforeEach(() => {
    signIn.mockReset()
    signUp.mockReset()
    sessionStorage.clear()
  })

  it('login restores pending token flow after successful auth', async () => {
    sessionStorage.setItem('student-invite-pending', JSON.stringify({ type: 'token', value: 'abc123' }))
    signIn.mockResolvedValue({ error: null })

    renderLogin()
    expect(screen.getByText('После входа вы вернётесь к приглашению.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('your@email.ru'), { target: { value: 'student@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'secret12' } })
    fireEvent.click(screen.getByText('Войти'))

    expect(await screen.findByText('join-restored')).toBeInTheDocument()
  })

  it('signup in invite mode hides full name and restores flow when session exists', async () => {
    sessionStorage.setItem('student-invite-pending', JSON.stringify({ type: 'token', value: 'abc123' }))
    signUp.mockResolvedValue({ error: null, data: { session: { access_token: 'x' } } })

    renderRegister()
    expect(screen.queryByLabelText('ФИО')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('your@email.ru'), { target: { value: 'student@example.com' } })
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: 'secret12' } })
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: 'secret12' } })
    fireEvent.click(screen.getByText('Зарегистрироваться'))

    await waitFor(() => expect(signUp).toHaveBeenCalled())
    expect(signUp.mock.calls[0][2]).toBe('')
    expect(signUp.mock.calls[0][4]).toMatchObject({ skipProfileInsert: true })
    expect(await screen.findByText('join-restored')).toBeInTheDocument()
  })

  it('signup in invite mode keeps confirmation state when email confirmation is required', async () => {
    sessionStorage.setItem('student-invite-pending', JSON.stringify({ type: 'code', value: 'ABCD1234' }))
    signUp.mockResolvedValue({ error: null, data: { session: null } })

    renderRegister()
    fireEvent.change(screen.getByPlaceholderText('your@email.ru'), { target: { value: 'student@example.com' } })
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: 'secret12' } })
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: 'secret12' } })
    fireEvent.click(screen.getByText('Зарегистрироваться'))

    expect(await screen.findByText('Подтвердите email. После подтверждения приглашение останется доступным.')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('student-invite-pending') || '{}')).toEqual({ type: 'code', value: 'ABCD1234' })
  })
})
