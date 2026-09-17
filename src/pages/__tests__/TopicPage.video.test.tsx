import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §204. Вкладка «Видео» темы у ученика.
 *
 * До этой правки у неё был свой разбор адреса (только YouTube и Vimeo), и
 * собственное видео школы на Bunny показывалось ссылкой «Смотреть видео»
 * наружу — считать там было нечего. Тест держит и плеер, и отметку
 * «просмотрено», и то, что минут ученику не видно.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'
const GUID = '0016b4df-58da-4ba4-b94a-cdc2d4584d86'
const BUNNY_EMBED = `https://iframe.mediadelivery.net/embed/726880/${GUID}`

let materials: TopicMaterial[] = []
let watchRows: Array<Record<string, unknown>> = []
const queried: string[] = []

function chain(table: string, result: unknown, count = 0) {
  queried.push(table)
  const c: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data: result, error: null })
  c.maybeSingle = () => Promise.resolve({ data: result, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null, count }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      if (table === 'students') return chain(table, { id: 'student-1' })
      if (table === 'topics') return chain(table, {
        id: TOPIC, title: 'Кинематика', order_index: 0, available_from: null,
        modules: { id: 'mod-1', title: 'Механика', courses: { id: 'c1', title: 'Физика', subject: 'physics' } },
      })
      if (table === 'groups') return chain(table, { id: GROUP, name: '11А' })
      if (table === 'video_watch_daily') return chain(table, watchRows)
      return chain(table, null, 0)
    },
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'u1', role: 'student' } }),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials, loading: false, error: null }),
}))
vi.mock('@/hooks/useTopicSolutionState', () => ({
  useTopicSolutionState: () => ({ hasSolution: false, unlocked: false, loading: false }),
}))
vi.mock('@/components/courseProgram/TopicVariantStudent', () => ({
  TopicVariantStudent: () => null,
  useTopicStudentVariants: () => ({ variants: [] }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkStudent', () => ({ TopicHomeworkStudent: () => null }))
vi.mock('@/components/courseProgram/TopicTestStudent', () => ({ TopicTestStudent: () => null }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({ TopicMaterialItems: () => null }))

import { TopicPage } from '@/pages/TopicPage'

const bunnyVideo: TopicMaterial =
  { kind: 'video', id: 'v1', title: 'Видеоразбор', position: 0, isVisible: true, section: null, url: BUNNY_EMBED }

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/my-course/${GROUP}/topic/${TOPIC}`]}>
      <Routes>
        <Route path="/my-course/:groupId/topic/:topicId" element={<TopicPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  materials = [bunnyVideo]
  watchRows = []
  queried.length = 0
})

describe('Вкладка «Видео» темы (§204)', () => {
  it('видео Bunny показывается плеером, а не ссылкой наружу', async () => {
    renderPage()
    const frame = await screen.findByTitle('Видео темы')
    expect(frame).toHaveAttribute('src', BUNNY_EMBED)
    expect(screen.queryByText('Смотреть видео')).not.toBeInTheDocument()
  })

  it('дошёл до 90 % — стоит отметка «просмотрено»', async () => {
    watchRows = [{ item_id: 'v1', max_position: 830, duration_seconds: 900 }]
    renderPage()
    expect(await screen.findByTestId('video-watched-badge')).toHaveTextContent('Просмотрено')
  })

  it('не дошёл — отметки нет', async () => {
    watchRows = [{ item_id: 'v1', max_position: 300, duration_seconds: 900 }]
    renderPage()
    await waitFor(() => expect(queried).toContain('video_watch_daily'))
    expect(screen.queryByTestId('video-watched-badge')).not.toBeInTheDocument()
  })

  it('минут ученику не видно даже у просмотренного видео', async () => {
    watchRows = [{ item_id: 'v1', max_position: 900, duration_seconds: 900 }]
    const { container } = renderPage()
    await screen.findByTestId('video-watched-badge')
    expect(container.textContent).not.toMatch(/мин(ут)?\b|секунд/)
  })

  it('темы без видео вкладка не ломает: прежняя заглушка на месте', async () => {
    materials = []
    renderPage()
    expect(await screen.findByText('Видеоурок ещё не добавлен')).toBeInTheDocument()
  })

  it('внешняя ссылка, которую не узнали, по-прежнему открывается наружу', async () => {
    materials = [{ ...bunnyVideo, url: 'https://rutube.invalid/video/xyz' }]
    renderPage()
    expect(await screen.findByText('Смотреть видео')).toBeInTheDocument()
    expect(screen.queryByTitle('Видео темы')).not.toBeInTheDocument()
  })
})
