import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * §262. Загрузчики задач каталога (страницы каталога, корзина, PDF ученика,
 * конструктор вариантов) больше не просят у catalog_tasks ответ, решение, план
 * и критерии — после PENDING_262b база такой запрос отклонит целиком. Тексты
 * приходят от catalog_task_texts и подставляются в задачу; закрытые — пустые.
 * Подменён только транспорт supabase (PostgREST-цепочка и rpc).
 */
const SECRET = /answer_html|solution_html|solution_plan_html|grade_criteria_html/
const net = vi.hoisted(() => ({
  selects: [] as Array<{ table: string; cols: string }>,
  rpcs: [] as Array<[string, Record<string, unknown> | undefined]>,
}))

const TASKS = [
  { id: 't1', external_id: 1, section_id: 's1', subject: 'Математика', exam_type: 'ЕГЭ', statement_html: '<p>1</p>', has_answer: true, has_solution: true, position: 1, is_published: true, catalog_sections: { title: 'Раздел' } },
  { id: 't2', external_id: 2, section_id: 's1', subject: 'Математика', exam_type: 'ЕГЭ', statement_html: '<p>2</p>', has_answer: true, has_solution: true, position: 2, is_published: true, catalog_sections: { title: 'Раздел' } },
]

function chain(table: string) {
  const rows = (): unknown[] => {
    if (table === 'catalog_tasks') return TASKS
    if (table === 'catalog_sections') return [{ id: 's1', title: 'Раздел', subject: 'Математика', exam_type: 'ЕГЭ' }]
    if (table === 'test_variants') return [{ id: 'v1', title: 'Вариант' }]
    if (table === 'test_variant_items') return [{ id: 'i1', variant_id: 'v1', task_id: 't1', position: 1 }, { id: 'i2', variant_id: 'v1', task_id: 't2', position: 2 }]
    return []
  }
  const c: Record<string, unknown> = {}
  const self = () => c
  for (const m of ['eq', 'in', 'order', 'range', 'limit', 'ilike', 'not', 'gte', 'lte', 'neq', 'is']) c[m] = self
  c.select = (cols: string) => { net.selects.push({ table, cols }); return c }
  c.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
  c.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
  c.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(f, r)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => chain(table),
    rpc: (fn: string, args?: Record<string, unknown>) => {
      net.rpcs.push([fn, args])
      if (fn === 'catalog_task_texts') {
        return Promise.resolve({ data: (args!.p_task_ids as string[]).map(id => id === 't1'
          ? { task_id: id, allowed: true, reason: 'solved', answer_html: '<p>ответ 1</p>', solution_html: '<p>решение 1</p>', solution_plan_html: null, grade_criteria_html: null, has_plan: false, has_criteria: false }
          : { task_id: id, allowed: false, reason: null, answer_html: null, solution_html: null, solution_plan_html: null, grade_criteria_html: null, has_plan: true, has_criteria: false }), error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: 'https://x/y.png' } }) }) },
  },
}))
vi.mock('@/store/authStore', () => {
  const state = { profile: { id: 'p1', role: 'student' } }
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) }
})
vi.mock('@/store/staffModeStore', () => ({ useNeedsOwnDataFilter: () => false }))

import { useCatalogTask, useCatalogTasksBatch } from '@/hooks/useCatalog'
import { useVariantDetail } from '@/hooks/useVariants'

beforeEach(() => { net.selects = []; net.rpcs = [] })

function noSecretColumnsRequested() {
  const fromTasks = net.selects.filter(s => s.table === 'catalog_tasks')
  expect(fromTasks.length).toBeGreaterThan(0)
  for (const s of fromTasks) expect(s.cols).not.toMatch(SECRET)
  for (const s of fromTasks) expect(s.cols.trim()).not.toBe('*')
}

describe('загрузчики задач каталога (§262)', () => {
  it('пачка по id (корзина, PDF ученика, подборки): строки без ответов, тексты — от сервера по правилу', async () => {
    const { result } = renderHook(() => useCatalogTasksBatch(['t1', 't2']))
    await waitFor(() => expect(result.current.tasks).toHaveLength(2))
    noSecretColumnsRequested()
    expect(net.rpcs).toContainEqual(['catalog_task_texts', { p_task_ids: ['t1', 't2'] }])
    const [t1, t2] = result.current.tasks
    expect(t1).toMatchObject({ answer_html: '<p>ответ 1</p>', solution_html: '<p>решение 1</p>', answers_locked: false })
    expect(t2).toMatchObject({ answer_html: null, solution_html: null, answers_locked: true, has_plan: true })
  })

  it('одна задача (страница задачи): то же правило', async () => {
    const { result } = renderHook(() => useCatalogTask('t1'))
    await waitFor(() => expect(result.current.task).not.toBeNull())
    noSecretColumnsRequested()
    expect(net.rpcs).toContainEqual(['catalog_task_texts', { p_task_ids: ['t1'] }])
    expect(result.current.task).toMatchObject({ answer_html: '<p>ответ 1</p>', answers_locked: false })
  })

  it('вариант в конструкторе: строки без ответов, тексты — одним вызовом на все задачи', async () => {
    const { result } = renderHook(() => useVariantDetail('v1'))
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    noSecretColumnsRequested()
    expect(net.rpcs.filter(([f]) => f === 'catalog_task_texts')).toEqual([['catalog_task_texts', { p_task_ids: ['t1', 't2'] }]])
    expect(result.current.items[0].task).toMatchObject({ answer_html: '<p>ответ 1</p>', sectionTitle: 'Раздел' })
    expect(result.current.items[1].task).toMatchObject({ answer_html: null, answers_locked: true })
  })
})
