import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'

/**
 * §256. Хук каталога: состояние страницы, проверка, раскрытие, «+N к
 * прогнозу» моделью до/после. Подменён только `supabase.rpc` — разбор
 * ответов, обновление состояния и расчёт прогноза настоящие.
 */
const NOW = new Date()
const iso = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const state = {
  calls: [] as Array<[string, Record<string, unknown> | undefined]>,
  evidence: [] as unknown[],
  check: null as unknown,
  checkError: null as string | null,
  practiceError: null as string | null,
}
function baseEvidence() {
  const out: unknown[] = []
  let i = 0
  for (let n = 1; n <= 12; n++) for (let k = 0; k < 4; k++) out.push({ subject: 'math', ns: [n], source: 'hw', score: n === 6 ? 0 : k < 3 ? 1 : 0, at: iso(3), item: `hw:${i++}` })
  return out
}
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      state.calls.push([fn, args])
      if (fn === 'catalog_practice_state') {
        if (state.practiceError) return Promise.resolve({ data: null, error: { message: state.practiceError } })
        return Promise.resolve({ data: {
          rules: { low: 0.4, high: 0.7, zones: [{ key: 'growth', per_task: 5, milestones: [{ at: 10, bonus: 30 }] }] },
          number: { subject: 'math', n: 6, title: 'Простейшие уравнения', zone: 'growth', share: 0, solved: 3 },
          tasks: [{ task_id: 't1', checkable: true, attempts: 0, solved: false, counted: false, revealed: false }],
        }, error: null })
      }
      if (fn === 'student_exam_forecast_evidence') {
        return Promise.resolve({ data: { now: NOW.toISOString(), subjects: [{ subject: 'math' }], titles: [], evidence: state.evidence }, error: null })
      }
      if (fn === 'catalog_check_answer') {
        if (state.checkError) return Promise.resolve({ data: null, error: { message: state.checkError } })
        // база записала попытку — в следующих свидетельствах она уже есть
        state.evidence = [...state.evidence, { subject: 'math', ns: [6], source: 'catalog', score: 1, at: iso(0), item: 'catalog:t1' }]
        return Promise.resolve({ data: state.check, error: null })
      }
      if (fn === 'catalog_reveal_answer') return Promise.resolve({ data: { answer_html: '<p>7</p>', solved_before: false }, error: null })
      return Promise.resolve({ data: null, error: { message: 'нет функции' } })
    },
  },
}))

import { useCatalogPractice } from '@/hooks/useCatalogPractice'

beforeEach(() => {
  state.calls = []
  state.evidence = baseEvidence()
  state.checkError = null
  state.practiceError = null
  state.check = { verdict: 'correct', already_solved: false, counted: true, revealed_before: false, subject: 'math', n: 6, zone: 'growth', points: 5, solved: 4, milestone_bonus: 0, daily_bonus: 0, weekly_bonus: 0, answer_html: '<p>7</p>' }
})

describe('useCatalogPractice (§256)', () => {
  it('ученик: состояние страницы и прогноз «до» — одним разом; персоналу ничего не спрашивается', async () => {
    const { result } = renderHook(() => useCatalogPractice('s6', ['t1'], true))
    await waitFor(() => expect(result.current.state?.number?.n).toBe(6))
    expect(state.calls[0]).toEqual(['catalog_practice_state', { p_section_id: 's6', p_task_ids: ['t1'] }])
    await waitFor(() => expect(state.calls.some(([f]) => f === 'student_exam_forecast_evidence')).toBe(true))
    state.calls = []
    renderHook(() => useCatalogPractice('s6', ['t1'], false))
    await act(async () => { await Promise.resolve() })
    expect(state.calls).toEqual([])
  })

  it('верно и засчитано: задача решена, засчитано по номеру 4, «+N к прогнозу» > 0 из свидетельств до/после', async () => {
    const { result } = renderHook(() => useCatalogPractice('s6', ['t1'], true))
    await waitFor(() => expect(state.calls.some(([f]) => f === 'student_exam_forecast_evidence')).toBe(true))
    let out: Awaited<ReturnType<typeof result.current.check>> | null = null
    await act(async () => { out = await result.current.check('t1', '7') })
    expect(out!.result!.counted).toBe(true)
    expect(out!.change!.ready).toBe(true)
    expect(out!.change!.delta).toBeGreaterThan(0)
    expect(result.current.state!.tasks.t1).toMatchObject({ solved: true, counted: true, attempts: 1, lastVerdict: 'correct' })
    expect(result.current.state!.number!.solved).toBe(4)
  })

  it('раскрытие: отметка в базе, задача «revealed»; верная попытка после — без пересчёта прогноза', async () => {
    const { result } = renderHook(() => useCatalogPractice('s6', ['t1'], true))
    await waitFor(() => expect(result.current.state).not.toBeNull())
    let html: string | null = null
    await act(async () => { html = await result.current.reveal('t1') })
    expect(html).toBe('<p>7</p>')
    expect(result.current.state!.tasks.t1.revealed).toBe(true)
    state.check = { ...(state.check as object), counted: false, revealed_before: true, points: 0 }
    const before = state.calls.filter(([f]) => f === 'student_exam_forecast_evidence').length
    let out: Awaited<ReturnType<typeof result.current.check>> | null = null
    await act(async () => { out = await result.current.check('t1', '7') })
    expect(out!.change).toBeNull()
    expect(state.calls.filter(([f]) => f === 'student_exam_forecast_evidence').length).toBe(before)
  })

  it('ошибка базы — текст для ученика; функции нет — каталог как раньше (state null)', async () => {
    const { result } = renderHook(() => useCatalogPractice('s6', ['t1'], true))
    await waitFor(() => expect(result.current.state).not.toBeNull())
    state.checkError = 'RATE_LIMIT: не больше 30 проверок в минуту'
    let out: Awaited<ReturnType<typeof result.current.check>> | null = null
    await act(async () => { out = await result.current.check('t1', '7') })
    expect(out!.error).toBe('Слишком много проверок подряд — подождите минуту')

    state.practiceError = 'Could not find the function public.catalog_practice_state'
    const r2 = renderHook(() => useCatalogPractice('s7', ['t1'], true))
    await waitFor(() => expect(r2.result.current.error).toContain('catalog_practice_state'))
    expect(r2.result.current.state).toBeNull()
  })
})
