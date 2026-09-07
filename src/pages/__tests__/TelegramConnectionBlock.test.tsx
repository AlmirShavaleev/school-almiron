import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

const { requestTelegramLinkMock } = vi.hoisted(() => ({ requestTelegramLinkMock: vi.fn() }))

vi.mock('@/lib/telegramLinkApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/telegramLinkApi')>('@/lib/telegramLinkApi')
  return {
    ...actual,
    requestTelegramLink: requestTelegramLinkMock,
    disconnectTelegram: vi.fn(),
    sendTelegramTest: vi.fn(),
  }
})

let connectionResult: { data: unknown } = { data: null }
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(connectionResult),
        }),
      }),
    }),
  },
}))

const clipboardWriteText = vi.fn().mockResolvedValue(undefined)
Object.assign(navigator, { clipboard: { writeText: clipboardWriteText } })

import { TelegramConnectionBlock } from '@/pages/SettingsPage'

const LINK = 'https://t.me/almiron_bot?start=abc123XYZ'

describe('TelegramConnectionBlock — link wizard (waiting → expired / connected)', () => {
  beforeEach(() => {
    requestTelegramLinkMock.mockReset()
    requestTelegramLinkMock.mockResolvedValue(LINK)
    clipboardWriteText.mockClear()
    connectionResult = { data: null }
  })

  const props = {
    profileId: 'profile-1',
    telegramEnabled: true,
    variantTelegramEnabled: true,
    onToggleTelegram: vi.fn(),
    onToggleVariantTelegram: vi.fn(),
  }

  it('shows the QR, the link and the "/start <token>" copy hint after connecting', async () => {
    render(<TelegramConnectionBlock {...props} />)
    await waitFor(() => expect(screen.getByText('Подключить Telegram')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Подключить Telegram'))

    await waitFor(() => expect(screen.getByText('Ждём подтверждения от бота…')).toBeInTheDocument())
    expect(screen.getByText(LINK)).toBeInTheDocument()
    expect(screen.getByText('/start abc123XYZ')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Скопировать команду'))
    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith('/start abc123XYZ'))
  })

  it('honestly offers to start over once the 2-minute polling window expires with no connection', async () => {
    vi.useFakeTimers()
    try {
      render(<TelegramConnectionBlock {...props} />)
      await vi.waitFor(() => expect(screen.getByText('Подключить Telegram')).toBeInTheDocument())

      await act(async () => { fireEvent.click(screen.getByText('Подключить Telegram')) })
      await vi.waitFor(() => expect(screen.getByText('Ждём подтверждения от бота…')).toBeInTheDocument())

      // Продвигаем часы за пределы 2-минутного окна опроса (шаг 3с).
      for (let i = 0; i < 45; i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
      }

      expect(screen.getByText('Время ожидания истекло. Начните заново.')).toBeInTheDocument()
      expect(screen.getByText('Начать заново')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('switches to the connected view once the poll finds a connection', async () => {
    vi.useFakeTimers()
    try {
      render(<TelegramConnectionBlock {...props} />)
      await vi.waitFor(() => expect(screen.getByText('Подключить Telegram')).toBeInTheDocument())

      await act(async () => { fireEvent.click(screen.getByText('Подключить Telegram')) })
      await vi.waitFor(() => expect(screen.getByText('Ждём подтверждения от бота…')).toBeInTheDocument())

      connectionResult = { data: { telegram_chat_id: 1, telegram_username: 'petrov', is_enabled: true, connected_at: '2026-01-01' } }
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })

      expect(screen.getAllByText('Telegram подключён').length).toBeGreaterThan(0)
      expect(screen.getByText('@petrov')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
