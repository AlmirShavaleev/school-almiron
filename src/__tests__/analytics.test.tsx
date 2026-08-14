import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

/**
 * Счётчик просмотров Vercel Web Analytics подключён на всё приложение
 * (решение владельца 14.08). Здесь сторожатся ровно те три свойства, из-за
 * которых счётчик может навредить, а не просто «компонент отрисовался»:
 *
 * 1. **В разработке данные наружу не уходят.** Пакет выбирает адрес скрипта по
 *    режиму; боевой адрес `/_vercel/insights/script.js` — это отправка. Тест
 *    работает с НАСТОЯЩИМ пакетом (не заглушкой) и смотрит, какой адрес реально
 *    оказался в `<head>`: в тестовой и локальной сборке Vite `import.meta.env.DEV`
 *    истинен, значит режим development и адрес обязан быть отладочным.
 * 2. **Экземпляр один.** Приложение рендерится много раз подряд — скрипт в
 *    документе должен остаться ровно один, иначе просмотры считались бы дважды.
 * 3. **Счётчик не мешает маршрутизации.** Редирект гостя с `/` на `/login`
 *    происходит как раньше — счётчик стоит выше `Suspense` и на показ страницы
 *    не влияет.
 *
 * Собственных событий у нас нет: `track()` не вызывается нигде в `src`.
 */

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const p = Promise.resolve({ data: null, error: null })
          return p.then.bind(p)
        }
        return () => new Proxy({}, { get: () => () => undefined })
      },
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))

vi.mock('@/pages/LandingPage', () => ({ LandingPage: () => <div>landing-stub</div> }))
vi.mock('@/pages/PaymentResultPage', () => ({ PaymentResultPage: () => <div>payment-stub</div> }))
vi.mock('@/pages/auth/RegisterPage', () => ({ RegisterPage: () => <div>register-stub</div> }))
vi.mock('@/pages/auth/ForgotPasswordPage', () => ({ ForgotPasswordPage: () => <div>forgot-stub</div> }))
vi.mock('@/pages/auth/ResetPasswordPage', () => ({ ResetPasswordPage: () => <div>reset-stub</div> }))
vi.mock('@/pages/JoinPage', () => ({ JoinPage: () => <div>join-stub</div> }))
vi.mock('@/pages/JoinTeacherPage', () => ({ JoinTeacherPage: () => <div>join-teacher-stub</div> }))
vi.mock('@/AppRoutes', () => ({ default: () => <div>app-routes-stub</div> }))

import App from '@/App'
import { useAuthStore } from '@/store/authStore'

function analyticsScripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll<HTMLScriptElement>('script[src]'))
    .filter(script => /vercel|insights/.test(script.src))
}

describe('Vercel Web Analytics', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, session: null, profile: null, loading: true })
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('в разработке грузится отладочный скрипт, а не боевой сборщик', async () => {
    render(<App />)

    await waitFor(() => expect(analyticsScripts().length).toBeGreaterThan(0))
    const src = analyticsScripts()[0].src

    // Отладочный скрипт пишет события в консоль и не отправляет их.
    expect(src).toContain('script.debug.js')
    // Боевая отправка идёт на этот адрес — его в локальной разработке быть не должно.
    expect(src).not.toContain('/_vercel/insights/script.js')
  })

  it('скрипт остаётся один, сколько бы раз приложение ни смонтировали', async () => {
    render(<App />)
    await waitFor(() => expect(analyticsScripts().length).toBe(1))

    render(<App />)
    render(<App />)
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(analyticsScripts().length).toBe(1)
  })

  it('загружается с defer и своим обработчиком ошибки — первый экран от него не зависит', async () => {
    render(<App />)
    await waitFor(() => expect(analyticsScripts().length).toBe(1))

    const script = analyticsScripts()[0]
    expect(script.defer).toBe(true)
    expect(typeof script.onerror).toBe('function')
  })

  it('редирект гостя с `/` на `/login` работает при включённом счётчике', async () => {
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
  })
})
