import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

/**
 * §234. Хук тренировки: читает ТОЛЬКО дорожку training и скрытия своей темы;
 * переключатель пишет `topic_subtopic_hidden` и откатывается при отказе базы.
 */

const calls: Array<{ table: string; op: string; args: unknown[] }> = []
const state = { failWrite: false }

function builder(table: string, data: unknown) {
  const b: any = {}
  for (const op of ['select', 'eq', 'order', 'in']) {
    b[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return b }
  }
  b.then = (f: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(f)
  return b
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'topic_material_items') {
        return builder(table, [
          { id: 'a', topic_id: 't1', kind: 'file', title: null, storage_path: 't1/a.pdf', file_name: null, size_bytes: null, position: 0, is_visible: true, section: 'theory', subtopic_code: '1.17', subtopic_title: 'Бросок' },
          { id: 'b', topic_id: 't1', kind: 'file', title: null, storage_path: 't1/b.pdf', file_name: null, size_bytes: null, position: 0, is_visible: true, section: 'theory', subtopic_code: '1.14', subtopic_title: 'Падение' },
        ])
      }
      const b = builder(table, [{ subtopic_code: '1.14' }])
      b.insert = (row: unknown) => { calls.push({ table, op: 'insert', args: [row] }); return Promise.resolve({ error: state.failWrite ? { message: 'RLS' } : null }) }
      b.delete = () => {
        calls.push({ table, op: 'delete', args: [] })
        const d: any = { eq: (...args: unknown[]) => { calls.push({ table, op: 'eq', args }); return d } }
        d.then = (f: (v: unknown) => unknown) => Promise.resolve({ error: state.failWrite ? { message: 'RLS' } : null }).then(f)
        return d
      }
      return b
    },
  },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'teacher-1' } }),
}))

import { useTopicTraining } from '@/hooks/useTopicTraining'

describe('useTopicTraining (§234)', () => {
  beforeEach(() => { calls.length = 0; state.failWrite = false })

  it('читает дорожку training своей темы и скрытия этой темы', async () => {
    const { result } = renderHook(() => useTopicTraining('t1'))
    await waitFor(() => expect(result.current.subtopics).toHaveLength(2))
    expect(calls).toContainEqual({ table: 'topic_material_items', op: 'eq', args: ['track', 'training'] })
    expect(calls).toContainEqual({ table: 'topic_material_items', op: 'eq', args: ['topic_id', 't1'] })
    expect(calls).toContainEqual({ table: 'topic_subtopic_hidden', op: 'eq', args: ['topic_id', 't1'] })
    expect(result.current.subtopics.map(s => [s.code, s.hidden])).toEqual([['1.14', true], ['1.17', false]])
  })

  it('скрыть — вставка строки с автором, показать — удаление по теме и коду', async () => {
    const { result } = renderHook(() => useTopicTraining('t1'))
    await waitFor(() => expect(result.current.subtopics).toHaveLength(2))

    await act(() => result.current.setSubtopicHidden('1.17', true))
    expect(calls).toContainEqual({ table: 'topic_subtopic_hidden', op: 'insert', args: [{ topic_id: 't1', subtopic_code: '1.17', hidden_by: 'teacher-1' }] })
    expect(result.current.subtopics.find(s => s.code === '1.17')?.hidden).toBe(true)

    await act(() => result.current.setSubtopicHidden('1.14', false))
    expect(calls).toContainEqual({ table: 'topic_subtopic_hidden', op: 'eq', args: ['subtopic_code', '1.14'] })
    expect(result.current.subtopics.find(s => s.code === '1.14')?.hidden).toBe(false)
  })

  it('отказ базы — ошибка и откат переключателя', async () => {
    const { result } = renderHook(() => useTopicTraining('t1'))
    await waitFor(() => expect(result.current.subtopics).toHaveLength(2))
    state.failWrite = true

    await act(async () => {
      await expect(result.current.setSubtopicHidden('1.17', true)).rejects.toThrow('RLS')
    })
    expect(result.current.subtopics.find(s => s.code === '1.17')?.hidden).toBe(false)
  })
})
