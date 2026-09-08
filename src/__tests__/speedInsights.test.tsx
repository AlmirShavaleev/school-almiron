import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

/**
 * Vercel Speed Insights — замер скорости загрузки страниц у настоящих
 * посетителей. Подключён рядом со счётчиком просмотров (§131), но это
 * отдельный пакет: тот считает визиты, этот — время.
 *
 * Сторожатся ровно те свойства, из-за которых замер может навредить:
 *
 * 1. **В разработке данные наружу не уходят.** У пакета speed-insights НЕТ
 *    свойства `mode`: он определяет режим сам, читая `process.env.NODE_ENV`
 *    внутри try/catch, а в браузерном коде Vite `process` может отсутствовать —
 *    тогда пакет молча считает режим боевым и шлёт замеры с машины
 *    разработчика. Поэтому адрес скрипта задан явно по `import.meta.env.DEV`.
 *    Тест работает с НАСТОЯЩИМ пакетом (не с заглушкой) и смотрит, какой адрес
 *    реально оказался в `<head>`.
 * 2. **Экземпляр один.** Два скрипта — двойной замер и лишние запросы у
 *    ученика на слабой сети.
 * 3. **Первый экран от него не зависит.** Компонент стоит выше `Suspense`,
 *    скрипт грузится с `defer` и своим `onerror`: блокировщик или отсутствие
 *    сети дают строку в консоли, а не пустой экран.
 * 4. **В адреса ничего не добавляется.** `route`, `dsn`, `endpoint` не
 *    передаются — на скрипте не должно оказаться этих data-атрибутов
 *    (решение владельца по приватности из §131: в адресах только
 *    идентификаторы, ничего сверх).
 * 5. **Маршрутизация цела:** редирект гостя `/` → `/login` работает как раньше.
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

function speedInsightsScripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll<HTMLScriptElement>('script[src]'))
    .filter(script => script.src.includes('speed-insights'))
}

describe('Vercel Speed Insights', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, session: null, profile: null, loading: true })
    sessionStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('в разработке грузится отладочный скрипт, а не боевой сборщик', async () => {
    render(<App />)

    await waitFor(() => expect(speedInsightsScripts().length).toBeGreaterThan(0))
    const src = speedInsightsScripts()[0].src

    // Отладочный скрипт печатает замеры в консоль и не отправляет их.
    expect(src).toContain('speed-insights/script.debug.js')
    // Боевая отправка идёт на этот адрес — в локальной разработке его быть не должно.
    expect(src).not.toContain('/_vercel/speed-insights/script.js')
  })

  it('скрипт остаётся один, сколько бы раз приложение ни смонтировали', async () => {
    render(<App />)
    await waitFor(() => expect(speedInsightsScripts().length).toBe(1))

    render(<App />)
    render(<App />)
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(speedInsightsScripts().length).toBe(1)
  })

  it('загружается с defer и своим обработчиком ошибки — первый экран от него не зависит', async () => {
    render(<App />)
    await waitFor(() => expect(speedInsightsScripts().length).toBe(1))

    const script = speedInsightsScripts()[0]
    expect(script.defer).toBe(true)
    expect(typeof script.onerror).toBe('function')
  })

  it('в адреса ничего не добавляется: ни route, ни dsn, ни свой endpoint', async () => {
    render(<App />)
    await waitFor(() => expect(speedInsightsScripts().length).toBe(1))

    const { dataset } = speedInsightsScripts()[0]
    expect(dataset.route).toBeUndefined()
    expect(dataset.dsn).toBeUndefined()
    expect(dataset.endpoint).toBeUndefined()
  })

  it('счётчик просмотров и замер скорости — два РАЗНЫХ скрипта, а не один', async () => {
    render(<App />)

    await waitFor(() => expect(speedInsightsScripts().length).toBe(1))
    const analytics = Array.from(document.head.querySelectorAll<HTMLScriptElement>('script[src]'))
      .filter(script => /vercel|insights/.test(script.src) && !script.src.includes('speed-insights'))

    expect(analytics.length).toBe(1)
    expect(analytics[0].src).not.toBe(speedInsightsScripts()[0].src)
  })

  it('редирект гостя `/` → `/login` работает при включённом замере', async () => {
    render(<App />)

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
  })
})
