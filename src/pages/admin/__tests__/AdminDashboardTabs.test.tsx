import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Проводка вкладки «Видео» в панели админа.
 *
 * Файл узкий намеренно: остальная админка — чужая зона, и трогать её тесты
 * этой работой нечего. Здесь сторожатся ровно две вещи, обе про то, как
 * вкладка подключена.
 *
 * 1. **Вкладка есть и открывается.** Без неё вся работа недостижима из
 *    интерфейса.
 * 2. **Пока вкладку не открыли, в Bunny не ходим.** Хук `useVideoStats`
 *    смонтирован ВНУТРИ вкладки, а не на странице. Подними его на страницу
 *    (как `useVercelAnalytics`) — и каждое открытие админки дёргало бы
 *    edge-функцию у того, кто на эту вкладку не заглядывает. Проверка именно
 *    поведенческая: разработчику ничего не мешает «упростить» и вернуть хук
 *    наверх, а тест на присутствие вкладки этого не заметит.
 */

const invoke = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    from: () => new Proxy({}, {
      get(_t, prop) {
        if (prop === 'then') {
          const p = Promise.resolve({ data: [], error: null })
          return p.then.bind(p)
        }
        return () => new Proxy({}, { get: () => () => undefined })
      },
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))

vi.mock('@/hooks/useAdminDashboard', () => ({
  useAdminDashboard: () => ({
    profiles: [], groups: [], courses: [], stats: null,
    loading: false, reload: vi.fn(),
  }),
}))
vi.mock('@/hooks/useSchoolStats', () => ({
  useSchoolStats: () => ({ stats: null, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/hooks/useSchoolAnalytics', () => ({
  useSchoolAnalytics: () => ({
    dormant: [], activity: [], unopened: [],
    loading: false, error: null, reload: vi.fn(),
  }),
}))
vi.mock('@/hooks/useVercelAnalytics', () => ({
  useVercelAnalytics: () => ({
    totals7: { visitors: 0, pageviews: 0 }, totals30: { visitors: 0, pageviews: 0 },
    days: [], sections: [], referrers: [], devices: [], countries: [],
    fetchedAt: null, fromCache: false, throttled: false, partial: false, daysReturned: 0,
    loading: false, error: null, reload: vi.fn(),
  }),
}))
vi.mock('@/components/demo/QuickLogin', () => ({ QuickLogin: () => <div>quick-login-stub</div> }))
vi.mock('@/components/admin/StaffTab', () => ({ StaffTab: () => <div>staff-stub</div> }))
vi.mock('@/components/admin/SchoolActivity', () => ({ SchoolActivity: () => <div>activity-stub</div> }))

import { AdminDashboard } from '@/pages/admin/AdminDashboard'

const EMPTY_STATS = {
  lessons: [], unattachedInLibrary: 0, libraryTotalItems: 0,
  period: { days: 30, views: 0, watchTimeRaw: 0, points: 0 },
  fetched_at: '2026-09-09T10:00:00.000Z', source: 'cache', partial: false,
}

beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ data: EMPTY_STATS, error: null })
})

describe('вкладка «Видео» в панели админа', () => {
  it('вкладка есть в списке', () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Видео' })).toBeInTheDocument()
  })

  it('пока вкладку не открыли, в bunny-video-stats не ходим', async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)

    // Дать всем смонтированным эффектам отработать — если бы хук висел на
    // странице, запрос ушёл бы именно здесь.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Видео' })).toBeInTheDocument())
    expect(invoke).not.toHaveBeenCalledWith('bunny-video-stats', expect.anything())
  })

  it('по клику вкладка открывается и запрашивает статистику', async () => {
    render(<MemoryRouter><AdminDashboard /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'Видео' }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('bunny-video-stats', { body: {} }))
    await waitFor(() => expect(screen.getByTestId('video-stats')).toBeInTheDocument())
  })
})
