import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

/**
 * Страница `/watch/:id` (письмо 27.10) — один плеер для прямых ссылок.
 * С 28.10 (письмо ЛК_видео_на_телефоне_снова_в_уроке.md) из урока на неё не
 * ведём: на любом устройстве ▶ создаёт один iframe прямо в уроке.
 */

const GUID = '0016b4df-58da-4ba4-b94a-cdc2d4584d86'
const EMBED = `https://iframe.mediadelivery.net/embed/726880/${GUID}`
let row: Record<string, unknown> | null = { id: 'v1', title: 'Видеоразбор', url: EMBED, kind: 'video' }
const tables: string[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      tables.push(table)
      const c: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
      c.maybeSingle = () => Promise.resolve({ data: row, error: null })
      c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
      return c
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))
vi.mock('@/store/staffModeStore', () => ({ usePreviewMode: () => false }))
vi.mock('@/store/authStore', () => {
  const state = { profile: { id: 'u1', role: 'student' } }
  return { useAuthStore: (sel: (s: unknown) => unknown) => sel(state) }
})

import { WatchVideoPage } from '@/pages/WatchVideoPage'
import { WatchedVideo } from '@/components/courseProgram/WatchedVideo'

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname}</div>
}

const LESSON = '/my-course/g1/topic/t1'

function renderApp(start: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: start, state }]}>
      <Routes>
        <Route path="/my-course/:groupId/topic/:topicId" element={
          <><WatchedVideo materialId="v1" embed={EMBED} title="Видеоразбор" countWatch /><Where /></>
        } />
        <Route path="/watch/:materialId" element={<><WatchVideoPage /><Where /></>} />
        <Route path="/dashboard" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

function setPhone(phone: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: phone && q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} }),
  })
}

beforeEach(() => {
  row = { id: 'v1', title: 'Видеоразбор', url: EMBED, kind: 'video' }
  tables.length = 0
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('▶ в уроке на любом устройстве — плеер прямо в уроке', () => {
  for (const phone of [true, false]) {
    it(`${phone ? 'телефон' : 'компьютер'}: один iframe в уроке, перехода на /watch нет`, () => {
      setPhone(phone)
      if (phone) Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
      renderApp(LESSON)
      expect(document.querySelector('iframe')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Смотреть: Видеоразбор' }))
      expect(screen.getByTestId('video-iframe')).toBeInTheDocument()
      expect(document.querySelectorAll('iframe')).toHaveLength(1)
      expect(screen.getByTestId('where')).toHaveTextContent(LESSON)
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    })
  }
})

describe('страница /watch/:id', () => {
  it('один iframe Bunny: autoplay, без предзагрузки, в странице и без плеера iOS; только запрос ролика', async () => {
    renderApp('/watch/v1', { from: LESSON })
    const src = new URL((await screen.findByTestId('watch-iframe')).getAttribute('src')!)
    expect(`${src.origin}${src.pathname}`).toBe(EMBED)
    for (const [k, v] of [['autoplay', 'true'], ['preload', 'false'], ['playsinline', 'true'], ['disableIosPlayer', 'true']]) {
      expect(src.searchParams.get(k)).toBe(v)
    }
    expect(screen.getByRole('heading')).toHaveTextContent('Видеоразбор')
    expect(tables).toEqual(['topic_material_items'])
  })

  it('«← К уроку» после перезагрузки (истории нет) — на урок, откуда пришли', async () => {
    renderApp('/watch/v1', { from: LESSON })
    await screen.findByTestId('watch-iframe')
    fireEvent.click(screen.getByTestId('watch-back'))
    expect(await screen.findByTestId('where')).toHaveTextContent(LESSON)
  })

  it('ролика нет или он скрыт правами — «видео недоступно», iframe нет', async () => {
    row = null
    renderApp('/watch/v1')
    expect(await screen.findByTestId('watch-unavailable')).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
  })
})
