import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * §168. Сохранение через форму даёт embed-адрес.
 *
 * Хук здесь НЕ подменяется, в отличие от соседнего `TopicMaterialItems.test.tsx`:
 * проверяется весь путь «поле → хук → insert», потому что именно на этом
 * пути 12.09 адреса «play» и потока CDN доехали до базы как есть.
 */

const GUID = '0016b4df-58da-4ba4-b94a-cdc2d4584d86'
const EMBED = `https://iframe.mediadelivery.net/embed/726880/${GUID}`
const TOPIC = 'f0000000-0000-0000-0000-000000000001'

const inserted: Array<Record<string, unknown>> = []

function chain() {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'in', 'limit', 'eq']) c[m] = () => c
  c.insert = (payload: Record<string, unknown>) => {
    inserted.push(payload)
    return c
  }
  c.single = () => {
    const last = inserted[inserted.length - 1]
    return Promise.resolve({
      data: {
        id: `m${inserted.length}`, content: null, storage_path: null, file_name: null,
        mime_type: null, size_bytes: null, is_visible: true, section: null,
        created_at: '2026-09-13T00:00:00Z', updated_at: '2026-09-13T00:00:00Z',
        ...last,
      },
      error: null,
    })
  }
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => chain(),
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({}) },
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'u1', role: 'teacher' } }),
}))

import { TopicMaterialItems } from '@/components/courseProgram/TopicMaterialItems'

beforeEach(() => {
  inserted.length = 0
})

async function addVideoThroughForm(url: string) {
  render(<TopicMaterialItems topicId={TOPIC} canManage section="video" />)
  const input = await screen.findByPlaceholderText(/Ссылка на Bunny/)
  fireEvent.change(input, { target: { value: url } })
  fireEvent.click(screen.getByText('Добавить видео'))
  await waitFor(() => expect(inserted).toHaveLength(1))
  return inserted[0]
}

describe('Форма видео темы — адрес Bunny (§168)', () => {
  it('страница «play» из панели Bunny сохраняется embed-адресом', async () => {
    const row = await addVideoThroughForm(`https://player.mediadelivery.net/play/726880/${GUID}`)
    expect(row).toMatchObject({ kind: 'video', url: EMBED, topic_id: TOPIC })
  })

  it('прямой поток CDN сохраняется embed-адресом нашей библиотеки', async () => {
    const row = await addVideoThroughForm(`https://vz-1a2b3c-4d5.b-cdn.net/${GUID}/playlist.m3u8`)
    expect(row.url).toBe(EMBED)
  })

  it('голый guid сохраняется embed-адресом', async () => {
    const row = await addVideoThroughForm(GUID)
    expect(row.url).toBe(EMBED)
  })

  it('сохранённое видео сразу показывается плеером, а не голой ссылкой', async () => {
    await addVideoThroughForm(`https://player.mediadelivery.net/play/726880/${GUID}`)
    await waitFor(() => expect(screen.getByTitle('Видео темы')).toHaveAttribute('src', EMBED))
  })

  it('внешняя ссылка (не Bunny) сохраняется как есть', async () => {
    const row = await addVideoThroughForm('https://youtu.be/abc123')
    expect(row.url).toBe('https://youtu.be/abc123')
  })
})
