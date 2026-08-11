import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * Маршрутизация корня после того, как лендинг сняли с главной (12.08).
 *
 * Что здесь сторожится и почему именно это:
 *
 * 1. Гость на `/` попадает на форму входа, а не на витрину. Владелец хочет,
 *    чтобы `alminion.ru` вёл сразу в платформу.
 * 2. Вошедший на `/` попадает в кабинет, а не на «войдите». Это не косметика:
 *    `/login` обратно на `/` не отправляет, поэтому ошибочный редирект стал бы
 *    для человека с живой сессией тупиком.
 * 3. **Публичные адреса остаются публичными.** Это главная страховка файла: по
 *    `/join`, `/join/:token` и `/jt/:token` приходят приглашённые ученики и
 *    преподаватели — они гости по определению. Любой редирект на вход ломает
 *    приглашения молча, а заметно это станет только на живом ученике.
 * 4. Петли нет: `/` → `/login` → (никуда). Проверяется тем, что адрес после
 *    редиректа стабилен, а не одним лишь первым переходом.
 *
 * Страницы подменены заглушками намеренно: файл о таблице маршрутов, а не о
 * содержимом страниц. Исключение — `LoginPage`: её собственный редирект
 * «вошедшего не держим на форме» проверяется настоящим компонентом.
 */

let sessionValue: { user: { id: string; email: string } } | null = null
let profileRow: Record<string, unknown> | null = null

function makeProfilesChain() {
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        const p = Promise.resolve({ data: profileRow, error: null })
        return p.then.bind(p)
      }
      return () => chain
    },
  })
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => makeProfilesChain(),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: sessionValue } }),
      signInWithPassword: () => Promise.resolve({ data: null, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))

// Страницы-заглушки: тест про адреса, а не про их содержимое.
vi.mock('@/pages/LandingPage', () => ({ LandingPage: () => <div>landing-stub</div> }))
vi.mock('@/pages/PaymentResultPage', () => ({ PaymentResultPage: () => <div>payment-stub</div> }))
vi.mock('@/pages/auth/RegisterPage', () => ({ RegisterPage: () => <div>register-stub</div> }))
vi.mock('@/pages/auth/ForgotPasswordPage', () => ({ ForgotPasswordPage: () => <div>forgot-stub</div> }))
vi.mock('@/pages/auth/ResetPasswordPage', () => ({ ResetPasswordPage: () => <div>reset-stub</div> }))
vi.mock('@/pages/JoinPage', () => ({ JoinPage: () => <div>join-stub</div> }))
vi.mock('@/pages/JoinTeacherPage', () => ({ JoinTeacherPage: () => <div>join-teacher-stub</div> }))
// Защищённое поддерево целиком — иначе тест потянул бы шесть десятков страниц.
vi.mock('@/AppRoutes', () => ({ default: () => <div>app-routes-stub</div> }))

import App from '@/App'
import { useAuthStore } from '@/store/authStore'

function goTo(path: string) {
  window.history.replaceState({}, '', path)
}

function pathname() {
  return window.location.pathname
}

describe('корень: лендинг снят с главной', () => {
  beforeEach(() => {
    sessionValue = null
    profileRow = null
    useAuthStore.setState({ user: null, session: null, profile: null, loading: true })
    sessionStorage.clear()
    goTo('/')
  })

  it('гость на `/` видит форму входа, а не лендинг', async () => {
    render(<App />)

    expect(await screen.findByText('Вход в систему')).toBeTruthy()
    expect(pathname()).toBe('/login')
    expect(screen.queryByText('landing-stub')).toBeNull()
  })

  it('редирект `/` → `/login` не зацикливается: адрес стабилен', async () => {
    render(<App />)
    await screen.findByText('Вход в систему')

    // Несколько тактов после редиректа: петля «вход → главная → вход» проявила
    // бы себя сменой адреса, а не первым переходом.
    for (let i = 0; i < 5; i++) await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(pathname()).toBe('/login')
    expect(screen.queryByText('Вход в систему')).toBeTruthy()
  })

  it('вошедший на `/` уходит в кабинет, а не на форму входа', async () => {
    sessionValue = { user: { id: 'u1', email: 'a@a.com' } }
    profileRow = { id: 'u1', email: 'a@a.com', full_name: 'Ann', role: 'student' }

    render(<App />)

    await waitFor(() => expect(pathname()).toBe('/dashboard'))
    expect(await screen.findByText('app-routes-stub')).toBeTruthy()
    expect(screen.queryByText('Вход в систему')).toBeNull()
  })

  it('вошедший с висящим приглашением возвращается к приглашению, а не в кабинет', async () => {
    sessionValue = { user: { id: 'u1', email: 'a@a.com' } }
    profileRow = { id: 'u1', email: 'a@a.com', full_name: 'Ann', role: 'student' }
    sessionStorage.setItem('student-invite-pending', JSON.stringify({ type: 'token', value: 'abc123' }))

    render(<App />)

    await waitFor(() => expect(pathname()).toBe('/join/abc123'))
  })

  it('пока сессия не разобрана, гостя на вход не отправляют', async () => {
    // `loading` держится true: getSession ещё не ответил. Ранний редирект здесь
    // и есть тот самый тупик — человек с живой сессией уехал бы на «войдите».
    let release: (value: { data: { session: null } }) => void = () => {}
    const pending = new Promise<{ data: { session: null } }>(resolve => { release = resolve })
    const supabase = (await import('@/lib/supabase')).supabase as any
    const original = supabase.auth.getSession
    supabase.auth.getSession = () => pending

    render(<App />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(pathname()).toBe('/')

    release({ data: { session: null } })
    await waitFor(() => expect(pathname()).toBe('/login'))
    supabase.auth.getSession = original
  })
})

describe('лендинг переехал на `/about`, а не удалён', () => {
  beforeEach(() => {
    sessionValue = null
    profileRow = null
    useAuthStore.setState({ user: null, session: null, profile: null, loading: true })
    sessionStorage.clear()
  })

  it('гость открывает `/about` и видит лендинг без редиректа на вход', async () => {
    goTo('/about')
    render(<App />)

    expect(await screen.findByText('landing-stub')).toBeTruthy()
    expect(pathname()).toBe('/about')
  })

  it('вошедшего с `/about` тоже не выгоняют — это публичная страница', async () => {
    sessionValue = { user: { id: 'u1', email: 'a@a.com' } }
    profileRow = { id: 'u1', email: 'a@a.com', full_name: 'Ann', role: 'teacher' }
    goTo('/about')
    render(<App />)

    expect(await screen.findByText('landing-stub')).toBeTruthy()
    expect(pathname()).toBe('/about')
  })
})

/**
 * Список публичных адресов — явным перечнем. Если кто-то однажды заведёт
 * общий гвард «всё, кроме /login, — за вход», этот перечень упадёт целиком,
 * а не по одному ученику в поддержке.
 */
const PUBLIC_PATHS: Array<[string, string]> = [
  ['/about',           'landing-stub'],
  ['/login',           'Вход в систему'],
  ['/register',        'register-stub'],
  ['/forgot-password', 'forgot-stub'],
  ['/reset-password',  'reset-stub'],
  ['/join',            'join-stub'],
  ['/join/ABC123',     'join-stub'],
  ['/jt/token-42',     'join-teacher-stub'],
  ['/payment-result',  'payment-stub'],
]

describe('публичные адреса гостя не перехватываются', () => {
  beforeEach(() => {
    sessionValue = null
    profileRow = null
    useAuthStore.setState({ user: null, session: null, profile: null, loading: true })
    sessionStorage.clear()
  })

  it.each(PUBLIC_PATHS)('%s открывается у гостя и адрес не меняется', async (path, marker) => {
    goTo(path)
    render(<App />)

    expect(await screen.findByText(marker)).toBeTruthy()
    expect(pathname()).toBe(path)
  })
})

describe('форма входа не держит вошедшего', () => {
  beforeEach(() => {
    sessionValue = { user: { id: 'u1', email: 'a@a.com' } }
    profileRow = { id: 'u1', email: 'a@a.com', full_name: 'Ann', role: 'student' }
    useAuthStore.setState({ user: null, session: null, profile: null, loading: true })
    sessionStorage.clear()
  })

  it('вошедший, открывший `/login`, уезжает в кабинет (обратной петли нет)', async () => {
    goTo('/login')
    render(<App />)

    await waitFor(() => expect(pathname()).toBe('/dashboard'))
    expect(screen.queryByText('Вход в систему')).toBeNull()
  })

  it('после выхода из аккаунта форма входа показывается, а не редиректит', async () => {
    // Ровно то состояние, которое оставляет после себя выход (`signOut` →
    // `reset()`): сессии нет, профиля нет, загрузка окончена. Сюда и Sidebar, и
    // DashboardLayout отправляют человека адресом `/login`.
    sessionValue = null
    profileRow = null
    useAuthStore.setState({ user: null, session: null, profile: null, loading: false })
    goTo('/login')

    render(<App />)

    expect(await screen.findByText('Вход в систему')).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(pathname()).toBe('/login')
  })
})
