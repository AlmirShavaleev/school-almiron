import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { JoinPage } from '@/pages/JoinPage'
import { useAuthStore } from '@/store/authStore'

const acceptStudentInvite = vi.fn()
const acceptStudentInviteByCode = vi.fn()
const acceptCourseJoin = vi.fn()
const ensureStudentProfile = vi.fn()
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
    ensureStudentProfile: () => ensureStudentProfile(),
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
    ensureStudentProfile.mockReset()
    ensureStudentProfile.mockResolvedValue(null)
    signOut.mockReset()
    useAuthStore.setState({ user: null, profile: null, loading: false } as any)
    localStorage.clear()
    sessionStorage.clear()
  })

  it('token route is available without auth and stores token in localStorage', async () => {
    renderJoin('/join/token-123')
    expect(screen.getByText('Войти')).toBeInTheDocument()
    expect(screen.getByText('Зарегистрироваться')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('student-invite-pending') || '{}')).toMatchObject({ type: 'token', value: 'token-123' })
  })

  it('code route is available without auth and stores normalized code in localStorage', async () => {
    renderJoin('/join')
    fireEvent.change(screen.getByLabelText('Код приглашения'), { target: { value: 'ab cd-12' } })
    expect((screen.getByLabelText('Код приглашения') as HTMLInputElement).value).toBe('ABCD-12')
    expect(JSON.parse(localStorage.getItem('student-invite-pending') || '{}')).toMatchObject({ type: 'code', value: 'ABCD12' })
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

  it('accepts by token, protects against double submit, shows success and clears the stored invite', async () => {
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
    expect(localStorage.getItem('student-invite-pending')).toBeNull()
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
    // 'invalid' и 'unknown' уходят в курсовой fallback — он тоже должен упасть,
    // чтобы проверить именно текст ошибки, показанный человеку.
    if (_kind === 'invalid' || _kind === 'unknown') {
      acceptCourseJoin.mockRejectedValue(new Error(message))
    }

    renderJoin('/join/token-secret-123')
    fireEvent.click(screen.getByText('Присоединиться'))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText(/token-secret-123/i)).not.toBeInTheDocument()
  })

  describe('курсовой fallback (постоянная ссылка/код курса)', () => {
    function asStudent() {
      useAuthStore.setState({
        user: { id: 'u1', email: 's@example.com' },
        profile: { id: 'u1', email: 's@example.com', full_name: 'Student', role: 'student', created_at: '', updated_at: '' },
        loading: false,
      } as any)
    }

    async function failLegacyWith(kind: string, message: string) {
      const { InvitationAcceptanceError } = await import('@/lib/studentInvitationAcceptance')
      acceptStudentInvite.mockRejectedValue(new InvitationAcceptanceError(kind as any, message))
      acceptStudentInviteByCode.mockRejectedValue(new InvitationAcceptanceError(kind as any, message))
    }

    // Главный продовый сценарий: токен курса → легаси INVITE_NOT_FOUND
    // (kind='invalid') → course_join_accept.
    it('kind=invalid → доходит до course_join_accept и показывает курс', async () => {
      asStudent()
      await failLegacyWith('invalid', 'Ссылка или код приглашения недействительны.')
      acceptCourseJoin.mockResolvedValue({ groupId: 'g-1', courseId: 'c-1', courseTitle: 'Физика ЕГЭ', joinedAs: 'student' })

      renderJoin('/join/course-token-1')
      fireEvent.click(screen.getByText('Присоединиться'))

      await waitFor(() => expect(acceptCourseJoin).toHaveBeenCalledWith('course-token-1'))
      expect(await screen.findByText('Вы присоединились')).toBeInTheDocument()
      expect(screen.getByText(/Физика ЕГЭ/)).toBeInTheDocument()
      expect(localStorage.getItem('student-invite-pending')).toBeNull()
    })

    it('нераспознанная ошибка легаси (kind=unknown) тоже доходит до course_join_accept', async () => {
      asStudent()
      await failLegacyWith('unknown', 'Не удалось обработать приглашение')
      acceptCourseJoin.mockResolvedValue({ groupId: 'g-1', courseId: 'c-1', courseTitle: 'Физика ЕГЭ', joinedAs: 'student' })

      renderJoin('/join/course-token-1')
      fireEvent.click(screen.getByText('Присоединиться'))

      await waitFor(() => expect(acceptCourseJoin).toHaveBeenCalledWith('course-token-1'))
      expect(await screen.findByText('Вы присоединились')).toBeInTheDocument()
    })

    it('курсовой код тоже доходит до course_join_accept', async () => {
      asStudent()
      await failLegacyWith('invalid', 'Ссылка или код приглашения недействительны.')
      acceptCourseJoin.mockResolvedValue({ groupId: 'g-1', courseId: 'c-1', courseTitle: 'Физика ЕГЭ', joinedAs: 'student' })

      renderJoin('/join')
      fireEvent.change(screen.getByLabelText('Код приглашения'), { target: { value: 'ab cd12' } })
      fireEvent.click(screen.getByText('Присоединиться'))

      await waitFor(() => expect(acceptCourseJoin).toHaveBeenCalledWith('ABCD12'))
    })

    it('кураторская ссылка показывает кураторский экран', async () => {
      asStudent()
      await failLegacyWith('invalid', 'Ссылка или код приглашения недействительны.')
      acceptCourseJoin.mockResolvedValue({ groupId: null, courseId: 'c-1', courseTitle: 'Физика ЕГЭ', joinedAs: 'curator' })

      renderJoin('/join/curator-token')
      fireEvent.click(screen.getByText('Присоединиться'))

      expect(await screen.findByText('Вы куратор курса «Физика ЕГЭ»')).toBeInTheDocument()
      expect(screen.getByText('К проверке ДЗ')).toBeInTheDocument()
    })

    // Осмысленные отказы легаси не должны подменяться курсовым fallback'ом.
    it.each([
      ['used', 'Это приглашение уже использовано.'],
      ['revoked', 'Приглашение было отозвано. Обратитесь к преподавателю за новой ссылкой.'],
      ['expired', 'Срок действия приглашения истёк. Обратитесь к преподавателю за новой ссылкой.'],
      ['email_unconfirmed', 'Подтвердите email, затем вернитесь к приглашению.'],
      ['wrong_role', 'Это приглашение предназначено для аккаунта ученика. Выйдите и войдите в ученический аккаунт.'],
      ['group_full', 'В этой группе больше нет свободных мест.'],
      ['group_unavailable', 'Группа больше недоступна.'],
      ['network', 'Нет соединения. Проверьте интернет и попробуйте снова.'],
    ])('kind=%s НЕ уходит в курсовой fallback и показывается человеку', async (kind, message) => {
      asStudent()
      await failLegacyWith(kind, message)
      acceptCourseJoin.mockResolvedValue({ groupId: 'g-1', courseId: 'c-1', courseTitle: 'Физика ЕГЭ', joinedAs: 'student' })

      renderJoin('/join/token-secret-123')
      fireEvent.click(screen.getByText('Присоединиться'))

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(acceptCourseJoin).not.toHaveBeenCalled()
      expect(screen.queryByText('Вы присоединились')).not.toBeInTheDocument()
    })

    it('при kind=unknown падение курсовой RPC не подменяет исходную ошибку', async () => {
      asStudent()
      await failLegacyWith('unknown', 'Не удалось обработать приглашение')
      acceptCourseJoin.mockRejectedValue(new Error('Ссылка или код не найдены. Проверьте код у преподавателя.'))

      renderJoin('/join/some-token')
      fireEvent.click(screen.getByText('Присоединиться'))

      expect(await screen.findByText('Не удалось обработать приглашение')).toBeInTheDocument()
    })

    it('при kind=invalid показывается сообщение курсовой RPC', async () => {
      asStudent()
      await failLegacyWith('invalid', 'Ссылка или код приглашения недействительны.')
      acceptCourseJoin.mockRejectedValue(new Error('Набор закрыт. Обратитесь к преподавателю.'))

      renderJoin('/join/some-token')
      fireEvent.click(screen.getByText('Присоединиться'))

      expect(await screen.findByText('Набор закрыт. Обратитесь к преподавателю.')).toBeInTheDocument()
    })

    // Регистрация по приглашению идёт со skipProfileInsert → в сторе профиля нет,
    // а DashboardLayout при пустом профиле выкидывает на /login.
    it('после вступления без профиля в сторе подтягивает его', async () => {
      useAuthStore.setState({ user: { id: 'u1', email: 's@example.com' }, profile: null, loading: false } as any)
      await failLegacyWith('invalid', 'Ссылка или код приглашения недействительны.')
      acceptCourseJoin.mockResolvedValue({ groupId: 'g-1', courseId: 'c-1', courseTitle: 'Физика ЕГЭ', joinedAs: 'student' })
      ensureStudentProfile.mockResolvedValue({ id: 'u1', email: 's@example.com', full_name: 's', role: 'student', created_at: '', updated_at: '' })

      renderJoin('/join/course-token-1')
      fireEvent.click(screen.getByText('Присоединиться'))

      expect(await screen.findByText('Вы присоединились')).toBeInTheDocument()
      await waitFor(() => expect(useAuthStore.getState().profile?.id).toBe('u1'))
    })

    it('существующий профиль в сторе не перезапрашивается', async () => {
      asStudent()
      acceptStudentInvite.mockResolvedValue({ inviteId: 'i1', studentId: 's1', groupId: 'group-77' })

      renderJoin('/join/token-123')
      fireEvent.click(screen.getByText('Присоединиться'))

      expect(await screen.findByText('Вы присоединились')).toBeInTheDocument()
      expect(ensureStudentProfile).not.toHaveBeenCalled()
    })
  })

  function loginAsStaff(role = 'teacher') {
    useAuthStore.setState({
      user: { id: 'u2', email: 't@example.com' },
      profile: { id: 'u2', email: 't@example.com', full_name: 'Teacher', role, created_at: '', updated_at: '' },
      loading: false,
    } as any)
  }

  it('shows wrong-role state and lets the user switch account', async () => {
    loginAsStaff()

    renderJoin('/join/token-123')
    expect(screen.getByText(/Это приглашение предназначено для аккаунта ученика/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Войти в другой аккаунт'))
    await waitFor(() => expect(signOut).toHaveBeenCalled())
  })

  /**
   * Продовый случай владельца: сохранённое приглашение уводило его с главной
   * сюда при каждом заходе, а отсюда предлагался единственный ход — сменить
   * аккаунт. Менять аккаунт он не хочет, он хочет в свой кабинет.
   */
  describe('чужое приглашение: выход из тупика', () => {
    it('«Это не моё приглашение» вычищает запись и ведёт в кабинет', async () => {
      localStorage.setItem('student-invite-pending', JSON.stringify({
        type: 'token', value: 'token-123', savedAt: Date.now(),
      }))
      loginAsStaff('owner')

      render(
        <MemoryRouter initialEntries={['/join/token-123']}>
          <Routes>
            <Route path="/join/:token" element={<JoinPage />} />
            <Route path="/dashboard" element={<div>dashboard-stub</div>} />
          </Routes>
        </MemoryRouter>,
      )
      fireEvent.click(screen.getByTestId('join-not-mine'))

      expect(await screen.findByText('dashboard-stub')).toBeInTheDocument()
      expect(localStorage.getItem('student-invite-pending')).toBeNull()
      // Аккаунт при этом не трогаем: человек остаётся в своём.
      expect(signOut).not.toHaveBeenCalled()
    })

    it('персоналу приглашение здесь НЕ сохраняется заново — иначе ловушка взводится снова', () => {
      loginAsStaff('teacher')

      renderJoin('/join/token-123')

      expect(localStorage.getItem('student-invite-pending')).toBeNull()
    })

    it('уже сохранённое приглашение остаётся на месте: человек может уйти менять аккаунт', () => {
      // Вычищать его при одном лишь показе страницы нельзя — после входа
      // учеником приглашение должно дождаться и сработать.
      localStorage.setItem('student-invite-pending', JSON.stringify({
        type: 'token', value: 'token-123', savedAt: Date.now(),
      }))
      loginAsStaff('teacher')

      renderJoin('/join/token-123')

      expect(localStorage.getItem('student-invite-pending')).not.toBeNull()
    })
  })
})
