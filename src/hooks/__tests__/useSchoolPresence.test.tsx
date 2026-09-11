import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { renderHook } from '@testing-library/react'

/**
 * Публикатор присутствия.
 *
 * Тонкая обёртка над `acquirePresence` — глубокие проверки канала живут в
 * `schoolPresence.test.ts`. Здесь три вещи, которые видны только со стороны
 * React:
 *
 * 1. Гость ничего не публикует: не вошёл — не «онлайн в школе».
 * 2. Уход со страницы отпускает канал.
 * 3. Два публикатора дают ОДИН канал: компонент может оказаться смонтирован и
 *    на всё приложение, и на экране панели, и это не должно плодить сокеты.
 */

const release = vi.fn()
const acquire = vi.fn((_profileId: string, _role: string) => release)

vi.mock('@/lib/schoolPresence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/schoolPresence')>('@/lib/schoolPresence')
  return {
    ...actual,
    acquirePresence: (profileId: string, role: string) => acquire(profileId, role),
  }
})

let profile: { id: string; role: string } | null = null

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: any) => unknown) => selector({ profile }),
}))

import { useSchoolPresence } from '@/hooks/useSchoolPresence'
import { SchoolPresencePublisher } from '@/components/admin/SchoolPresencePublisher'

beforeEach(() => {
  acquire.mockClear()
  release.mockClear()
  profile = { id: 'p-1', role: 'student' }
})

describe('useSchoolPresence', () => {
  it('публикует идентификатор и роль вошедшего', () => {
    renderHook(() => useSchoolPresence())
    expect(acquire).toHaveBeenCalledWith('p-1', 'student')
  })

  it('гость ничего не публикует', () => {
    profile = null
    renderHook(() => useSchoolPresence())
    expect(acquire).not.toHaveBeenCalled()
  })

  it('уход со страницы отпускает канал', () => {
    const { unmount } = renderHook(() => useSchoolPresence())
    unmount()
    expect(release).toHaveBeenCalledTimes(1)
  })
})

describe('SchoolPresencePublisher', () => {
  it('ничего не рисует', () => {
    const { container } = render(<SchoolPresencePublisher />)
    expect(container).toBeEmptyDOMElement()
  })

  it('два публикатора — по одному захвату на каждый, канал общий', () => {
    // Счётчик ссылок внутри `acquirePresence` сводит их к одному сокету
    // (проверено в schoolPresence.test.ts). Здесь важно, что второй монтаж не
    // падает и честно берёт и отпускает свою ссылку.
    const { unmount } = render(
      <>
        <SchoolPresencePublisher />
        <SchoolPresencePublisher />
      </>,
    )
    expect(acquire).toHaveBeenCalledTimes(2)
    unmount()
    expect(release).toHaveBeenCalledTimes(2)
  })
})
