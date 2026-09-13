import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * §169: порог воронки привязки Telegram и совместимость с RPC, которая новых
 * ключей ещё не отдаёт.
 *
 * Порог — одно правило в одном месте (`telegramLinkingBroken`), и здесь он
 * проверяется впрямую по граничным значениям: «Обзор» красит строку именно
 * им, а не своей копией.
 *
 * Миграция и клиент выкатываются порознь: клиент может оказаться на проде
 * раньше, чем оркестратор применит SQL. Хук тогда обязан подставить нули, а
 * не уронить «Обзор» на `undefined > 0`.
 */

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}))

import { useSchoolStats, telegramLinkingBroken, TELEGRAM_FUNNEL_MIN_LINKS } from '@/hooks/useSchoolStats'

const OLD_RPC_ANSWER = {
  teachers: 8, students: 53, courses: 10,
  homework_submitted_total: 31, homework_submitted_7d: 23, homework_submitted_today: 0,
  homework_reviewed: 17, homework_pending: 14, homework_oldest_pending_days: 2,
  variants_completed: 1, telegram_connected: 27, visits_today: 4, visits_7d: 33,
}

beforeEach(() => { rpc.mockReset() })

describe('telegramLinkingBroken — порог по смыслу', () => {
  it('минимум ссылок для суждения — пять', () => {
    expect(TELEGRAM_FUNNEL_MIN_LINKS).toBe(5)
  })

  it('меньше пяти ссылок — не поломка даже при нуле привязок', () => {
    expect(telegramLinkingBroken(4, 0)).toBe(false)
    expect(telegramLinkingBroken(0, 0)).toBe(false)
  })

  it('пять ссылок и две привязки — поломка', () => {
    expect(telegramLinkingBroken(5, 2)).toBe(true)
  })

  it('ровно половина — ещё не поломка', () => {
    expect(telegramLinkingBroken(10, 5)).toBe(false)
    expect(telegramLinkingBroken(5, 3)).toBe(false)
  })

  it('20 % успешных, как 08.09, — поломка', () => {
    expect(telegramLinkingBroken(10, 2)).toBe(true)
  })

  it('привязок больше, чем ссылок (ссылка недельной давности), — не поломка', () => {
    expect(telegramLinkingBroken(5, 6)).toBe(false)
  })
})

describe('useSchoolStats с ответом RPC без ключей §169', () => {
  it('новые ключи подставляются нулями, старые доходят как есть', async () => {
    rpc.mockResolvedValue({ data: OLD_RPC_ANSWER, error: null })
    const { result } = renderHook(() => useSchoolStats())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeNull()
    expect(result.current.stats?.support_new).toBe(0)
    expect(result.current.stats?.telegram_links_created_7d).toBe(0)
    expect(result.current.stats?.telegram_links_connected_7d).toBe(0)
    expect(result.current.stats?.homework_pending).toBe(14)
    expect(result.current.stats?.homework_oldest_pending_days).toBe(2)
  })

  it('новые ключи из RPC не затираются нулями', async () => {
    rpc.mockResolvedValue({
      data: { ...OLD_RPC_ANSWER, support_new: 7, telegram_links_created_7d: 10, telegram_links_connected_7d: 2 },
      error: null,
    })
    const { result } = renderHook(() => useSchoolStats())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.stats?.support_new).toBe(7)
    expect(result.current.stats?.telegram_links_created_7d).toBe(10)
    expect(result.current.stats?.telegram_links_connected_7d).toBe(2)
  })

  it('отказ «только администратор» приходит словами', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'ONLY_ADMIN_SEES_SCHOOL_STATS' } })
    const { result } = renderHook(() => useSchoolStats())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.stats).toBeNull()
    expect(result.current.error).toBe('Статистику школы видит только администратор')
  })
})
