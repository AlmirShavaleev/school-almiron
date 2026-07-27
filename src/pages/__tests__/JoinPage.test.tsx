import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { JoinPage } from '@/pages/JoinPage'
import { useAuthStore } from '@/store/authStore'

const acceptStudentInvite = vi.fn()
const acceptStudentInviteByCode = vi.fn()
const acceptCourseJoin = vi.fn()
const signOut = vi.fn()

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut }),
}))

vi.mock('@/lib/studentInvitationAcceptance', () => {
  class InvitationAcceptanceError extends Error {
    kind: string
    constructor(kind: string, message: string) {
      super(message)
      this.kind = kind
    }
  }
  return {
    acceptStudentInvite: (token: string) => acceptStudentInvite(token),
    acceptStudentInviteByCode: (code: string) => acceptStudentInviteByCode(code),
    acceptCourseJoin: (value: string) => acceptCourseJoin(value),
    InvitationAcceptanceError,
  }
})

function renderJoin(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:token" element={<JoinPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('JoinPage', () => {
  beforeEach(() => {
    acceptStudentInvite.mockReset()
    acceptStudentInviteByCode.mockReset()
    acceptCourseJoin.mockReset()
    signOut.mockReset()
    useAuthStore.setState({ user: null, profile: null, loading: false } as any)
    sessionStorage.clear()
  })

  it('token route is available without auth and stores token in sessionStorage', async () => {
    renderJoin('/join/token-123')
    expect(screen.getByText('Войти')).toBeInTheDocument()
    expect(screen.getByText('Зарегистрироваться')).toBeInTheDocument()
    expect(JSON.parse(sessionStorage.getItem('student-invite-pending') || '{}')).toEqual({ type: 'token', value: 'token-123' })
  })

  it('code route is available without auth and stores normalized code in sessionStorage', async () => {
    renderJoin('/join')
    fireEvent.change(screen.getByLabelText('Код приглашения'), { target: { value: 'ab cd-12' } })
    expect((screen.getByLabelText('Код приглашения') as HTMLInputElement).value).toBe('ABCD-12')
    expect(JSON.parse(sessionStorage.getItem('student-invite-pending') || '{}')).toEqual({ type: 'code', value: 'ABCD12' })
  })

  it('authenticated student sees confirm button and does not accept automatically', async () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 's@example.com' },
      profile: { id: 'u1', email: 's@example.com', full_name: 'Student', role: 'student', created_at: '', updated_at: '' },
      loading: false,
    } as any)
    renderJoin('/join/token-123')

    expect(screen.getByText('Присоединиться')).toBeInTheDocument()
    expect(acceptStudentInvite).not.toHaveBeenCalled()
  })

  it('accepts by token, protects against double submit, shows success and clears sessionStorage', async () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 's@example.com' },
      profile: { id: 'u1', email: 's@example.com', full_name: 'Student', role: 'student', created_at: '', updated_at: '' },
      loading: false,
    } as any)
    acceptStudentInvite.mockResolvedValue({ inviteId: 'i1', studentId: 's1', groupId: 'group-77' })

    renderJoin('/join/token-123')
    const button = screen.getByText('Присоединиться')
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => expect(acceptStudentInvite).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Вы присоединились')).toBeInTheDocument()
    expect(screen.getByText('Открыть курс')).toBeInTheDocument()
    expect(sessionStorage.getItem('student-invite-pending')).toBeNull()
  })

  it('accepts by short code', async () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 's@example.com' },
      profile: { id: 'u1', email: 's@example.com', full_name: 'Student', role: 'student', created_at: '', updated_at: '' },
      loading: false,
    } as any)
    acceptStudentInviteByCode.mockResolvedValue({ inviteId: 'i1', studentId: 's1', groupId: 'group-77' })

    renderJoin('/join')
    fireEvent.change(screen.getByLabelText('Код приглашения'), { target: { value: 'ab cd12' } })
    fireEvent.click(screen.getByText('Присоединиться'))

    await waitFor(() => expect(acceptStudentInviteByCode).toHaveBeenCalledWith('ABCD12'))
  })

  it.each([
    ['invalid', 'Ссылка или код приглашения недействительны.'],
    ['expired', 'Срок действия приглашения истёк. Обратитесь к преподавателю за новой ссылкой.'],
    ['revoked', 'Приглашение было отозвано. Обратитесь к преподавателю за новой ссылкой.'],
    ['used', 'Это приглашение уже использовано.'],
    ['wrong_role', 'Это приглашение предназначено для аккаунта ученика. Выйдите и войдите в ученический аккаунт.'],
    ['email_unconfirmed', 'Подтвердите email, затем вернитесь к приглашению.'],
    ['group_full', 'В этой группе больше нет свободных мест.'],
    ['network', 'Нет соединения. Проверьте интернет и попробуйте снова.'],
    ['unknown', 'Не удалось обработать приглашение'],
  ])('shows mapped %s error without leaking token', async (_kind, message) => {
    useAuthStore.setState({
      user: { id: 'u1', email: 's@example.com' },
      profile: { id: 'u1', email: 's@example.com', full_name: 'Student', role: 'student', created_at: '', updated_at: '' },
      loading: false,
    } as any)
    const { InvitationAcceptanceError } = await import('@/lib/studentInvitationAcceptance')
    acceptStudentInvite.mockRejectedValue(new InvitationAcceptanceError(_kind as any, message))
    // For 'invalid' errors, also mock acceptCourseJoin to fail
    if (_kind === 'invalid') {
      acceptCourseJoin.mockRejectedValue(new Error(message))
    }

    renderJoin('/join/token-secret-123')
    fireEvent.click(screen.getByText('Присоединиться'))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText(/token-secret-123/i)).not.toBeInTheDocument()
  })

  it('shows wrong-role state and lets the user switch account', async () => {
    useAuthStore.setState({
      user: { id: 'u2', email: 't@example.com' },
      profile: { id: 'u2', email: 't@example.com', full_name: 'Teacher', role: 'teacher', created_at: '', updated_at: '' },
      loading: false,
    } as any)

    renderJoin('/join/token-123')
    expect(screen.getByText('Это приглашение предназначено для аккаунта ученика. Выйдите и войдите в ученический аккаунт.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Войти в другой аккаунт'))
    await waitFor(() => expect(signOut).toHaveBeenCalled())
  })
})
