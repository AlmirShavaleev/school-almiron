import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

/**
 * §176. Почему ученик не видел «Неверно»: после ответа хук перечитывал строки
 * через ту же `load()`, что и при первом открытии, — с `loading = true`. На
 * это время лента заменялась спиннером, карточка задачи размонтировалась и
 * её локальное состояние (введённый ответ, подсветка «неверно») пропадало.
 * Здесь проверяется сам механизм: после ответа/разбора/«Разобрал» `loading`
 * не поднимается, строки при этом перечитываются.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'

const rpcCalls: { name: string; args: Record<string, unknown> }[] = []
let rows: Record<string, unknown>[] = []
let rpcErrors: Record<string, string> = {}

// Ответ сервера приходит на следующем тике, а не микрозадачей: иначе React
// успел бы схлопнуть `loading: true → false` в один рендер, и спиннер —
// тот самый, что прятал карточку, — в тесте был бы невидим и на старом коде.
const tick = () => new Promise(r => setTimeout(r, 0))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      await tick()
      if (rpcErrors[name]) return { data: null, error: { message: rpcErrors[name] } }
      if (name === 'topic_tasks_for_student') return { data: rows, error: null }
      if (name === 'answer_topic_task') {
        rows = rows.map(r => r.item_id === args.p_item_id
          ? { ...r, is_correct: false, attempts_count: (r.attempts_count as number) + 1, answer_raw: args.p_answer_raw }
          : r)
        return { data: { is_correct: false, attempts_count: 1 }, error: null }
      }
      return { data: null, error: null }
    },
  },
}))

import { useTopicTasks, humanizeTaskError } from '@/hooks/useTopicTasks'

function row(n: number) {
  return {
    student_assignment_id: 'sa-1', item_id: `item-${n}`, item_position: n, task_id: `task-${n}`,
    statement_html: `Условие ${n}`, assets: [], max_points: 1, auto_checkable: true,
    answer_raw: null, is_correct: null, attempts_count: 0, closed_by: null,
    solution_shown_at: null, solution_html: null, answer_html: null,
  }
}

// Два теста ниже нарочно зовут действия хука без `act`: внутри `act` React
// копит обновления до конца блока, и промежуточный рендер со спиннером — тот,
// что прятал карточку, — был бы невидим. Предупреждение «not wrapped in act»
// на это время выключаем, оно тут ожидаемо.
const g = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
function withoutActWarnings<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.IS_REACT_ACT_ENVIRONMENT
  g.IS_REACT_ACT_ENVIRONMENT = false
  return fn().finally(() => { g.IS_REACT_ACT_ENVIRONMENT = prev })
}

describe('useTopicTasks — перечитывание после действий не прячет экран (§176)', () => {
  beforeEach(() => {
    rpcCalls.length = 0
    rows = [row(1), row(2)]
    rpcErrors = {}
  })

  it('первая загрузка — с индикатором; после ответа строки перечитаны, а loading не поднимался', async () => {
    const seenLoading: boolean[] = []
    const { result } = renderHook(() => {
      const t = useTopicTasks(TOPIC)
      seenLoading.push(t.loading)
      return t
    })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.rows).toHaveLength(2)

    seenLoading.length = 0
    const verdict = await withoutActWarnings(async () => {
      const p = result.current.answer('item-1', '5')
      await waitFor(() => expect(result.current.rows[0]).toMatchObject({ attempts_count: 1 }))
      return p
    })
    expect(verdict).toBe(false)
    // Строки перечитаны: попытка и неверный ответ пришли с сервера…
    expect(rpcCalls.filter(c => c.name === 'topic_tasks_for_student')).toHaveLength(2)
    expect(result.current.rows[0]).toMatchObject({ attempts_count: 1, is_correct: false, answer_raw: '5' })
    // …но ни в одном рендере по пути `loading` не был true — карточка на месте.
    expect(seenLoading.some(Boolean)).toBe(false)
    expect(result.current.busyItem).toBeNull()
  })

  it('разбор и «Разобрал» тоже перечитывают строки без индикатора', async () => {
    const seenLoading: boolean[] = []
    const { result } = renderHook(() => {
      const t = useTopicTasks(TOPIC)
      seenLoading.push(t.loading)
      return t
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    seenLoading.length = 0

    await withoutActWarnings(async () => {
      await result.current.reveal('item-1')
      await result.current.closeSelf('item-1')
      await waitFor(() => expect(result.current.busyItem).toBeNull())
    })

    expect(rpcCalls.filter(c => c.name === 'topic_tasks_for_student')).toHaveLength(3)
    expect(seenLoading.some(Boolean)).toBe(false)
  })

  it('отказ сервера приходит словами ученику, а не кодом', async () => {
    rpcErrors = { reveal_topic_task_solution: 'NOT_ATTEMPTED_YET: solution opens after the first attempt' }
    const { result } = renderHook(() => useTopicTasks(TOPIC))
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => { await result.current.reveal('item-1') })
    expect(result.current.error).toBe('Сначала попробуй ответить — решение откроется после первой попытки')
  })
})

describe('humanizeTaskError — коды §176', () => {
  it('NOT_ATTEMPTED_YET и SOLUTION_SHOWN — словами', () => {
    expect(humanizeTaskError('NOT_ATTEMPTED_YET: solution opens after the first attempt'))
      .toBe('Сначала попробуй ответить — решение откроется после первой попытки')
    expect(humanizeTaskError('SOLUTION_SHOWN: answer after solution is self-check'))
      .toBe('Решение уже открыто — отметь задачу как разобранную')
  })

  it('SOLUTION_NOT_SHOWN не путается с SOLUTION_SHOWN; прежние коды на месте', () => {
    expect(humanizeTaskError('SOLUTION_NOT_SHOWN: open the solution first')).toBe('Сначала откройте решение.')
    expect(humanizeTaskError('NOT_SOLVED_YET: solution opens after the correct answer'))
      .toBe('Сначала попробуй ответить — решение откроется после первой попытки')
    expect(humanizeTaskError('ALREADY_SOLVED: task is already closed')).toBe('Задача уже решена.')
    expect(humanizeTaskError('NOT_AUTO_CHECKABLE: x')).toContain('нет короткого ответа')
    expect(humanizeTaskError('AUTO_CHECKABLE: x')).toBe('Эту задачу закрывает верный ответ, а не отметка.')
    expect(humanizeTaskError('ACCESS_DENIED: x')).toBe('Задача недоступна.')
    expect(humanizeTaskError('что-то другое')).toBe('что-то другое')
  })
})
