import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * board/011: мобильные браузеры молча блокируют `window.open(url)`, вызванный
 * ПОСЛЕ `await` — не всплывающее окно с точки зрения пользователя, но именно
 * так его видит браузер. Проверяем ровно то, что требует приёмка: после
 * нажатия появляется настоящая ссылка `<a href>` с адресом из ответа функции
 * и команда `/start`, а `window.open` в файле не вызывается вовсе.
 */
const { requestTelegramLinkMock, fetchOwnTelegramLinkedMock, sendTelegramTestMock, toastErrorMock } = vi.hoisted(() => ({
  requestTelegramLinkMock:   vi.fn(),
  fetchOwnTelegramLinkedMock: vi.fn(),
  sendTelegramTestMock:      vi.fn(),
  toastErrorMock:            vi.fn(),
}))

vi.mock('@/lib/telegramLinkApi', async () => {
  const actual = await vi.importActual<typeof import('@/lib/telegramLinkApi')>('@/lib/telegramLinkApi')
  return {
    ...actual,
    requestTelegramLink: requestTelegramLinkMock,
    fetchOwnTelegramLinked: fetchOwnTelegramLinkedMock,
    sendTelegramTest: sendTelegramTestMock,
  }
})

vi.mock('@/store/toastStore', () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}))

const windowOpenSpy = vi.spyOn(window, 'open')

import { TelegramOnboarding } from '@/components/shared/TelegramOnboarding'
import { useAuthStore } from '@/store/authStore'
import { useTelegramOnboardingStore } from '@/store/telegramOnboardingStore'

const LINK = 'https://t.me/almiron_bot?start=abc123XYZ'

function renderCard() {
  return render(<MemoryRouter><TelegramOnboarding /></MemoryRouter>)
}

describe('TelegramOnboarding card — opening the bot on a click, not window.open after await', () => {
  beforeEach(() => {
    localStorage.clear()
    useTelegramOnboardingStore.setState({ dismissed: false, profileId: null })
    useAuthStore.setState({ profile: { id: 'stud-1', role: 'student' } as any })
    requestTelegramLinkMock.mockReset()
    requestTelegramLinkMock.mockResolvedValue(LINK)
    fetchOwnTelegramLinkedMock.mockReset()
    fetchOwnTelegramLinkedMock.mockResolvedValue(false)
    sendTelegramTestMock.mockReset()
    sendTelegramTestMock.mockResolvedValue(undefined)
    toastErrorMock.mockClear()
    windowOpenSpy.mockClear()
  })

  it('shows a real <a href> link with the token and the /start copy hint after clicking, and never calls window.open', async () => {
    renderCard()
    await waitFor(() => expect(fetchOwnTelegramLinkedMock).toHaveBeenCalled())

    fireEvent.click(await screen.findByTestId('tg-onboarding-connect'))

    const link = await screen.findByText(LINK)
    expect(link.closest('a')).toHaveAttribute('href', LINK)
    expect(link.closest('a')).toHaveAttribute('target', '_blank')
    expect(screen.getByText('/start abc123XYZ')).toBeInTheDocument()
    expect(windowOpenSpy).not.toHaveBeenCalled()
  })

  it('copies the /start command to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    renderCard()
    fireEvent.click(await screen.findByTestId('tg-onboarding-connect'))
    await screen.findByText(LINK)

    fireEvent.click(screen.getByTitle('Скопировать команду'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('/start abc123XYZ'))
  })
})
