import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §204. Отметка «просмотрено» у видео.
 *
 * Два условия владельца проверяются здесь, а не глазами: отметка появляется
 * на 90 % длительности и не раньше, и минут ученику не видно НИГДЕ. Второе
 * важнее: вернуть подростку самооценку после «ты посмотрел 12 минут из 90»
 * дороже, чем потом добавить цифру.
 */

const GUID = '0016b4df-58da-4ba4-b94a-cdc2d4584d86'
const VIDEO_URL = `https://iframe.mediadelivery.net/embed/726880/${GUID}`
const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const ME = 'p0000000-0000-0000-0000-000000000001'

let materials: TopicMaterial[] = []
let watchRows: Array<Record<string, unknown>> = []
let watchError: { message: string } | null = null
const queried: string[] = []

function chain(table: string) {
  queried.push(table)
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
  c.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: watchError ? null : watchRows, error: watchError }).then(resolve)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => chain(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}))

vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({
    materials, loading: false, error: null, reload: vi.fn(),
    uploadMaterialFile: vi.fn(), addMaterial: vi.fn(), deleteMaterial: vi.fn(),
    toggleVisibility: vi.fn(), moveMaterial: vi.fn(),
  }),
}))

let preview = false
vi.mock('@/store/staffModeStore', () => ({ usePreviewMode: () => preview }))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ profile: { id: ME, role: 'student' } }),
}))

import { TopicMaterialItems } from '@/components/courseProgram/TopicMaterialItems'

const video = (id = 'v1'): TopicMaterial =>
  ({ kind: 'video', id, title: 'Видеоразбор', position: 0, isVisible: true, section: 'theory', url: VIDEO_URL })

beforeEach(() => {
  materials = [video()]
  watchRows = []
  watchError = null
  preview = false
  queried.length = 0
})

describe('Отметка «просмотрено» у видео (§204)', () => {
  it('появляется, когда ученик дошёл до 90 % ролика', async () => {
    watchRows = [{ item_id: 'v1', max_position: 810, duration_seconds: 900 }]
    render(<TopicMaterialItems topicId={TOPIC} canManage={false} section="video" />)

    expect(await screen.findByTestId('video-watched-badge')).toHaveTextContent('Просмотрено')
  })

  it('и не раньше: 89 % — отметки нет', async () => {
    watchRows = [{ item_id: 'v1', max_position: 800, duration_seconds: 900 }]
    render(<TopicMaterialItems topicId={TOPIC} canManage={false} section="video" />)

    await waitFor(() => expect(queried).toContain('video_watch_daily'))
    expect(screen.queryByTestId('video-watched-badge')).not.toBeInTheDocument()
  })

  it('без известной длительности отметки нет — знаменателя не выдумываем', async () => {
    watchRows = [{ item_id: 'v1', max_position: 5000, duration_seconds: null }]
    render(<TopicMaterialItems topicId={TOPIC} canManage={false} section="video" />)

    await waitFor(() => expect(queried).toContain('video_watch_daily'))
    expect(screen.queryByTestId('video-watched-badge')).not.toBeInTheDocument()
  })

  it('минут ученику не видно даже у просмотренного видео', async () => {
    watchRows = [{ item_id: 'v1', max_position: 900, duration_seconds: 900 }]
    const { container } = render(<TopicMaterialItems topicId={TOPIC} canManage={false} section="video" />)

    await screen.findByTestId('video-watched-badge')
    expect(container.textContent).not.toMatch(/мин|минут|секунд|\b15\b/)
  })

  it('отказ базы не рисует ни отметки, ни ошибки', async () => {
    watchError = { message: 'relation "video_watch_daily" does not exist' }
    render(<TopicMaterialItems topicId={TOPIC} canManage={false} section="video" />)

    await waitFor(() => expect(queried).toContain('video_watch_daily'))
    expect(screen.queryByTestId('video-watched-badge')).not.toBeInTheDocument()
    expect(screen.queryByText(/does not exist/)).not.toBeInTheDocument()
  })

  it('преподаватель отметок не спрашивает и не видит', async () => {
    watchRows = [{ item_id: 'v1', max_position: 900, duration_seconds: 900 }]
    render(<TopicMaterialItems topicId={TOPIC} canManage section="video" />)

    await screen.findByTitle('Видеоразбор')
    expect(queried).not.toContain('video_watch_daily')
    expect(screen.queryByTestId('video-watched-badge')).not.toBeInTheDocument()
  })

  it('в предпросмотре «глазами ученика» просмотр не считается и не спрашивается', async () => {
    preview = true
    watchRows = [{ item_id: 'v1', max_position: 900, duration_seconds: 900 }]
    render(<TopicMaterialItems topicId={TOPIC} canManage={false} section="video" />)

    await screen.findByTitle('Видеоразбор')
    expect(queried).not.toContain('video_watch_daily')
    expect(screen.queryByTestId('video-watched-badge')).not.toBeInTheDocument()
  })

  it('плеер остался плеером: тот же embed-адрес в iframe', async () => {
    render(<TopicMaterialItems topicId={TOPIC} canManage={false} section="video" />)
    expect(await screen.findByTitle('Видеоразбор')).toHaveAttribute('src', VIDEO_URL)
  })
})
