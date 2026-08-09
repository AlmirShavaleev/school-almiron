import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { lazy, Suspense } from 'react'
import { act, render, screen } from '@testing-library/react'
import { HARD_LIMIT_MS, LoadingGate, SOFT_LIMIT_MS } from '@/components/shared/LoadingGate'

/**
 * Смысл всей проверки: бесконечный спиннер не должен быть достижимым
 * состоянием. Владелец поймал на проде первый вход, висевший до F5, — причину
 * не нашли, но класс ошибки известен: шаг загрузки это промис, а промис может
 * не разрешиться никогда.
 *
 * Поэтому главный тест здесь — с промисом, который НЕ разрешается вовсе.
 */

describe('LoadingGate', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  function advance(ms: number) {
    act(() => { vi.advanceTimersByTime(ms) })
  }

  it('сначала показывает спиннер', () => {
    render(<LoadingGate label="профиль" />)
    expect(screen.getByTestId('loading-gate')).toBeInTheDocument()
    expect(screen.queryByTestId('loading-failed')).not.toBeInTheDocument()
  })

  it('затянувшаяся загрузка пишет в консоль — чтобы в следующий раз был сигнал', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<LoadingGate label="профиль пользователя" />)

    advance(SOFT_LIMIT_MS)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('профиль пользователя')
    // Спиннер ещё крутится: пять секунд — повод записать, а не сдаться.
    expect(screen.getByTestId('loading-gate')).toBeInTheDocument()
    expect(screen.getByText(/дольше обычного/)).toBeInTheDocument()
  })

  it('по истечении предела показывает ошибку с кнопкой «Обновить»', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<LoadingGate label="профиль" />)

    advance(HARD_LIMIT_MS)

    expect(screen.getByTestId('loading-failed')).toBeInTheDocument()
    expect(screen.getByText('Не удалось загрузить')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Обновить/ })).toBeInTheDocument()
    expect(screen.queryByTestId('loading-gate')).not.toBeInTheDocument()
  })

  it('до предела ошибку не показывает — медленная сеть это ещё не поломка', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<LoadingGate label="профиль" />)

    advance(HARD_LIMIT_MS - 1)

    expect(screen.queryByTestId('loading-failed')).not.toBeInTheDocument()
  })

  it('ГЛАВНОЕ: промис, который никогда не разрешается, приводит к ошибке, а не к вечному спиннеру', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Ровно тот случай, который поймал владелец: шаг загрузки не завершается
    // никогда. Никаких reject и таймаутов внутри — промис просто молчит.
    const NeverLoads = lazy(() => new Promise<never>(() => {}))

    render(
      <Suspense fallback={<LoadingGate label="страница кабинета" />}>
        <NeverLoads />
      </Suspense>,
    )

    expect(screen.getByTestId('loading-gate')).toBeInTheDocument()

    advance(HARD_LIMIT_MS)

    expect(screen.getByTestId('loading-failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Обновить/ })).toBeInTheDocument()
  })

  it('таймеры снимаются при размонтировании — успевшая загрузка не жалуется в консоль', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = render(<LoadingGate label="профиль" />)

    view.unmount()
    advance(HARD_LIMIT_MS)

    expect(warn).not.toHaveBeenCalled()
  })
})
