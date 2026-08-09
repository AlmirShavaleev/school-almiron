import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

/**
 * §101. Копия курса ссылается на те же объекты хранилища, поэтому «удалили
 * строку — удалили файл» стало опасным: так копия выбивала бы файл у шаблона.
 * Проверяем порядок и условие уборки, а не то, как он записан в коде.
 */

const events: string[] = []

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
// Путь общего объекта: первая папка — от темы ШАБЛОНА, не своя.
const SHARED_PATH = '9e813022-ace7-4f66-95c8-d3511126261f/1786140236248_konspekt.pdf'

const MATERIAL_ROW = {
  id: 'm1', topic_id: TOPIC, kind: 'file', title: null, content: null, url: null,
  storage_path: SHARED_PATH, file_name: 'konspekt.pdf', mime_type: 'application/pdf',
  size_bytes: 10, position: 0, is_visible: true, section: 'notes',
  created_by: 'u1', created_at: '2026-08-08T00:00:00Z', updated_at: '2026-08-08T00:00:00Z',
}

const HOMEWORK_ROW = { id: 'hw1', topic_id: TOPIC, is_published: false, due_at: null, grade_scale: null }
const HOMEWORK_FILE = {
  id: 'f1', homework_id: 'hw1', storage_path: SHARED_PATH, original_filename: 'konspekt.pdf',
  mime_type: 'application/pdf', size_bytes: 10, position: 0, created_at: '2026-08-08T00:00:00Z',
}

function chain(rows: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'in', 'limit', 'eq']) c[m] = () => c
  c.delete = () => { events.push('row-deleted'); return c }
  c.maybeSingle = () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null })
  c.single = () => Promise.resolve({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'topic_material_items') return chain([MATERIAL_ROW])
      if (table === 'topic_homework') return chain([HOMEWORK_ROW])
      if (table === 'topic_homework_files') return chain([HOMEWORK_FILE])
      return chain([])
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({ remove: () => Promise.resolve({ error: null }) }) },
  },
}))

const removeIfOrphan = vi.fn(async (...args: unknown[]) => {
  events.push(`orphan-check:${String(args[0])}`)
  return 'kept' as const
})
vi.mock('@/lib/storageRefs', () => ({
  removeIfOrphan: (...args: unknown[]) => removeIfOrphan(...args),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'u1', role: 'teacher' } }),
}))

import { useTopicMaterialItems } from '@/hooks/useTopicMaterialItems'
import { useTopicHomework } from '@/hooks/useTopicHomework'

beforeEach(() => {
  events.length = 0
  removeIfOrphan.mockClear()
})

describe('Удаление материала темы', () => {
  it('сначала строка, потом проверка ссылок — и в правильном бакете', async () => {
    const { result } = renderHook(() => useTopicMaterialItems(TOPIC))
    await waitFor(() => expect(result.current.materials).toHaveLength(1))

    await act(async () => { await result.current.deleteMaterial('m1') })

    expect(events).toEqual(['row-deleted', 'orphan-check:topic-materials'])
    expect(removeIfOrphan).toHaveBeenCalledWith('topic-materials', SHARED_PATH)
  })

  it('материал без файла уборку не запускает', async () => {
    const { result } = renderHook(() => useTopicMaterialItems(TOPIC))
    await waitFor(() => expect(result.current.materials).toHaveLength(1))

    await act(async () => { await result.current.deleteMaterial('нет-такого') })

    expect(removeIfOrphan).not.toHaveBeenCalled()
  })
})

describe('Удаление файла ДЗ', () => {
  it('порядок перевёрнут: строка раньше объекта', async () => {
    const { result } = renderHook(() => useTopicHomework(TOPIC))
    await waitFor(() => expect(result.current.files).toHaveLength(1))

    await act(async () => { await result.current.deleteHomeworkFile('f1') })

    // До §101 первым шёл remove объекта — с общими файлами это выбивало бы
    // файл у шаблона ещё до того, как выяснится, что он кому-то нужен.
    expect(events[0]).toBe('row-deleted')
    expect(removeIfOrphan).toHaveBeenCalledWith('topic-homework', SHARED_PATH)
  })
})
