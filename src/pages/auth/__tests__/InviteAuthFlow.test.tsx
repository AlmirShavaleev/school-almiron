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
    // Приглашение переехало из sessionStorage в localStorage — чистим оба:
    // на переходе читается ещё и старое место.
    localStorage.clear()
    sessionStorage.clear()
  })

  it('login restores pending token flow after successful auth', async () => {
    localStorage.setItem('student-invite-pending', JSON.stringify({ type: 'token', value: 'abc123' }))
    signIn.mockResolvedValue({ error: null })

    renderLogin()
    expect(screen.getByText('После входа вы вернётесь к приглашению.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('your@email.ru'), { target: { value: 'student@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'secret12' } })
    fireEvent.click(screen.getByText('Войти'))

    expect(await screen.findByText('join-restored')).toBeInTheDocument()
  })

  // Прежде этот тест закреплял обратное: «в режиме приглашения поля ФИО быть не
  // должно», и в signUp уходила пустая строка. Решение изменилось — имя
  // взять было неоткуда, и три живых ученика получили в профиль начало своей
  // почты вместо ФИО. Теперь поле обязательно в любом режиме, а проверка
  // сторожит именно то, ради чего правка делалась: непустое ФИО доезжает до
  // signUp, откуда попадает в метаданные регистрации.
  it('signup in invite mode still asks for the full name and passes it to signUp', async () => {
    localStorage.setItem('student-invite-pending', JSON.stringify({ type: 'token', value: 'abc123' }))
    signUp.mockResolvedValue({ error: null, data: { session: { access_token: 'x' } } })

    renderRegister()
    // Поиск по подписи снова честный: §134 связал <label> с полем в самом
    // Input (htmlFor/useId). До этого queryByLabelText('ФИО') отдавал null
    // независимо от того, есть поле на экране или нет, — поэтому §130 обходился
    // testid. Возвращаем запрос по подписи: он сторожит и наличие поля, и
    // наличие связи, из-за отсутствия которой скринридер поле не называл.
    fireEvent.change(screen.getByLabelText('ФИО'), { target: { value: '  Ахметов Ильдар  ' } })
    fireEvent.change(screen.getByPlaceholderText('your@email.ru'), { target: { value: 'student@example.com' } })
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: 'secret12' } })
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: 'secret12' } })
    fireEvent.click(screen.getByText('Зарегистрироваться'))

    await waitFor(() => expect(signUp).toHaveBeenCalled())
    expect(signUp.mock.calls[0][2]).toBe('Ахметов Ильдар')
    expect(signUp.mock.calls[0][4]).toMatchObject({ skipProfileInsert: true })
    expect(await screen.findByText('join-restored')).toBeInTheDocument()
  })

  it('signup in invite mode refuses to proceed without a full name', async () => {
    localStorage.setItem('student-invite-pending', JSON.stringify({ type: 'token', value: 'abc123' }))

    renderRegister()
    fireEvent.change(screen.getByPlaceholderText('your@email.ru'), { target: { value: 'student@example.com' } })
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: 'secret12' } })
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: 'secret12' } })
    fireEvent.click(screen.getByText('Зарегистрироваться'))

    expect(await screen.findByText('Введите ФИО')).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('signup in invite mode keeps confirmation state when email confirmation is required', async () => {
    localStorage.setItem('student-invite-pending', JSON.stringify({ type: 'code', value: 'ABCD1234' }))
    signUp.mockResolvedValue({ error: null, data: { session: null } })

    renderRegister()
    fireEvent.change(screen.getByTestId('register-full-name'), { target: { value: 'Ахметов Ильдар' } })
    fireEvent.change(screen.getByPlaceholderText('your@email.ru'), { target: { value: 'student@example.com' } })
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[0], { target: { value: 'secret12' } })
    fireEvent.change(screen.getAllByPlaceholderText('••••••••')[1], { target: { value: 'secret12' } })
    fireEvent.click(screen.getByText('Зарегистрироваться'))

    expect(await screen.findByText('Подтвердите email. После подтверждения приглашение останется доступным.')).toBeInTheDocument()
    // Именно здесь долгая жизнь записи и нужна: следующим шагом человек уходит
    // в почту и возвращается по ссылке подтверждения — часто в новой вкладке.
    expect(JSON.parse(localStorage.getItem('student-invite-pending') || '{}')).toMatchObject({ type: 'code', value: 'ABCD1234' })
  })
})
