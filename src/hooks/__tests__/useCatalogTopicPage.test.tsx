/**
 * Страница темы одним запросом: аргументы RPC, разбор ответа (тексты §262,
 * рисунки, счётчики), порции по прокрутке, запасной путь без миграции, замок
 * §292, отметка «выполнено» в кэше.
 */
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  upsert: vi.fn(async () => ({ error: null })),
  del: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({
      upsert: h.upsert,
      delete: () => ({ eq: () => ({ eq: async (...a: unknown[]) => { h.del(...a); return { error: null } } }) }),
    }),
  },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel?: (s: { profile: { id: string; role: string } }) => unknown) => {
    const s = { profile: { id: 'u1', role: 'student' } }
    return sel ? sel(s) : s
  },
}))

import { useCatalogTopicPage } from '../useCatalogTopicPage'

function task(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `t${n}`, external_id: 1000 + n, section_id: 's1', subject: 'Физика', exam_type: 'ЕГЭ', difficulty: 'средняя',
    statement_html: `<p>Условие ${n}</p>`, has_answer: true, has_solution: true, max_points: 1, position: n, exam_part: 1,
    is_completed: n === 1,
    assets: [{ id: `a${n}`, tex_session_id: null, kind: 'condition', storage_path: `x/${n}.png`, alt: null, position: 1 }],
    texts: { task_id: `t${n}`, allowed: false, reason: null, answer_html: null, solution_html: null,
      solution_plan_html: null, grade_criteria_html: null, has_plan: false, has_criteria: false },
    ...extra,
  }
}
function pageOf(from: number, count: number, filtered = 45) {
  return {
    data: { total: 45, done: 3, filtered, by_difficulty: { 'средняя': 45 }, offset: from, limit: 20,
      tasks: Array.from({ length: count }, (_, i) => task(from + i + 1)) },
    error: null,
  }
}

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}
const NONE = new Set<string>()

beforeEach(() => { h.rpc.mockReset(); h.upsert.mockClear(); h.del.mockClear() })

describe('useCatalogTopicPage', () => {
  it('первая порция: один вызов, аргументы, задачи с рисунками и закрытыми ответами, счётчики темы', async () => {
    h.rpc.mockResolvedValueOnce(pageOf(0, 20))
    const { result } = renderHook(() => useCatalogTopicPage({ topicId: 'topic', view: 'exam', filter: 'all', difficulties: NONE }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('catalog_topic_page', {
      p_topic_id: 'topic', p_source: null, p_filter: 'all', p_difficulties: null, p_offset: 0, p_limit: 20,
    })
    expect(result.current.missing).toBe(false)
    expect(result.current.tasks).toHaveLength(20)
    const t1 = result.current.tasks[0]
    expect(t1).toMatchObject({ id: 't1', is_completed: true, answers_locked: true, answer_html: null })
    expect(t1.assets).toHaveLength(1)
    expect(t1).not.toHaveProperty('texts')
    expect(result.current.stats).toEqual({ total: 45, done: 3, filtered: 45, byDifficulty: { 'средняя': 45 } })
    expect(result.current.hasMore).toBe(true)
  })

  it('следующие 20 — тем же вызовом со сдвигом; на последней порции — всё', async () => {
    h.rpc.mockResolvedValueOnce(pageOf(0, 20)).mockResolvedValueOnce(pageOf(20, 20)).mockResolvedValueOnce(pageOf(40, 5))
    const { result } = renderHook(() => useCatalogTopicPage({ topicId: 'topic', view: 'exam', filter: 'all', difficulties: NONE }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.tasks).toHaveLength(20))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.tasks).toHaveLength(40))
    expect(h.rpc.mock.calls[1][1]).toMatchObject({ p_offset: 20 })
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.tasks).toHaveLength(45))
    expect(result.current.hasMore).toBe(false)
  })

  it('«Физические темы» и фильтры уходят в RPC', async () => {
    h.rpc.mockResolvedValueOnce(pageOf(0, 2, 2))
    const diffs = new Set(['сложная', 'лёгкая'])
    const { result } = renderHook(() => useCatalogTopicPage({ topicId: 'topic', view: 'physics-topics', filter: 'todo', difficulties: diffs }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_source: 'ai_physics_v1', p_filter: 'todo', p_difficulties: ['лёгкая', 'сложная'] })
    expect(result.current.hasMore).toBe(false)
  })

  it('функции нет (миграция не применена) — missing, без повторов и без ошибки', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.catalog_topic_page' } })
    const { result } = renderHook(() => useCatalogTopicPage({ topicId: 'topic', view: 'exam', filter: 'all', difficulties: NONE }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.missing).toBe(true))
    expect(result.current.error).toBeNull()
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })

  it('§292: закрытый предмет — пустой список, не красная ошибка', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { hint: 'CATALOG_LOCKED', message: 'Банк задач откроется с подпиской или пробным периодом' } })
    const { result } = renderHook(() => useCatalogTopicPage({ topicId: 'topic', view: 'exam', filter: 'all', difficulties: NONE }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current).toMatchObject({ locked: true, error: null, tasks: [], missing: false })
  })

  it('прочая ошибка — текстом', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useCatalogTopicPage({ topicId: 'topic', view: 'exam', filter: 'all', difficulties: NONE }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.error).toBe('boom'), { timeout: 4000 })
  })

  it('«выполнено»: запись в базу и сразу в списке и счётчике', async () => {
    h.rpc.mockResolvedValueOnce(pageOf(0, 20))
    const { result } = renderHook(() => useCatalogTopicPage({ topicId: 'topic', view: 'exam', filter: 'all', difficulties: NONE }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.tasks).toHaveLength(20))
    await act(async () => { await result.current.toggleComplete('t2', false) })
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', task_id: 't2', is_completed: true }))
    // React Query оповещает подписчиков через setTimeout — ждём
    await waitFor(() => expect(result.current.tasks[1].is_completed).toBe(true))
    expect(result.current.stats?.done).toBe(4)
    await act(async () => { await result.current.toggleComplete('t1', true) })
    expect(h.del).toHaveBeenCalledWith('task_id', 't1')
    await waitFor(() => expect(result.current.tasks[0].is_completed).toBe(false))
    expect(result.current.stats?.done).toBe(3)
  })
})
