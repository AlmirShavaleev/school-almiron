import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { accuracyErrorText, accuracyLines, accuracyTotals } from '@/lib/aiCheckAccuracy'

/**
 * §238. Блок «ИИ-проверка: точность за 7 дней» в админке: строки RPC
 * `ai_check_accuracy` сворачиваются в шесть строк таблицы, как в выгрузке,
 * по которой строился светофор.
 */

let rpcResult: { data: unknown; error: unknown } = { data: [], error: null }
const rpc = vi.fn((..._args: unknown[]) => Promise.resolve(rpcResult))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))

import { AiCheckAccuracy } from '@/components/admin/AiCheckAccuracy'

/** Числа выгрузки оркестратора (34 работы, 336 заданий). */
const PROD_LIKE = [
  { ai_verdict: 'correct', answer_match: true, tasks: '235', changed: '11', works: '34' },
  { ai_verdict: 'correct', answer_match: false, tasks: 30, changed: 1, works: 20 },
  { ai_verdict: 'partial', answer_match: true, tasks: 23, changed: 20, works: 15 },
  { ai_verdict: 'partial', answer_match: false, tasks: 16, changed: 13, works: 10 },
  { ai_verdict: 'wrong', answer_match: true, tasks: 4, changed: 3, works: 4 },
  { ai_verdict: 'wrong', answer_match: false, tasks: 20, changed: 6, works: 12 },
  { ai_verdict: 'unchecked', answer_match: false, tasks: 8, changed: 6, works: 5 },
]

describe('§238. accuracyLines', () => {
  it('шесть строк, «неверно» и «не сверено» не делятся по ответу', () => {
    const lines = accuracyLines(PROD_LIKE)
    expect(lines.map(l => [l.key, l.tasks, l.changed, l.share])).toEqual([
      ['correct_equal', 235, 11, 5],
      ['correct_other', 30, 1, 3],
      ['partial_equal', 23, 20, 87],
      ['partial_other', 16, 13, 81],
      ['wrong', 24, 9, 38],
      ['unchecked', 8, 6, 75],
    ])
    expect(accuracyTotals(lines)).toEqual({ tasks: 336, greenShare: 70, greenChanged: 11 })
  })

  it('пусто — нули и «—» вместо процента', () => {
    const lines = accuracyLines([])
    expect(lines.every(l => l.tasks === 0 && l.share == null)).toBe(true)
    expect(accuracyTotals(lines).greenShare).toBeNull()
  })

  it('отказ словами', () => {
    expect(accuracyErrorText({ code: 'PGRST202', message: 'Could not find the function' })).toMatch(/после применения миграции/)
    expect(accuracyErrorText({ code: '42501', message: 'Только для администратора школы' })).toMatch(/только администратору/)
    expect(accuracyErrorText(null)).toBeNull()
  })
})

describe('§238. блок в админке', () => {
  beforeEach(() => { rpc.mockClear() })

  it('таблица из RPC', async () => {
    rpcResult = { data: PROD_LIKE, error: null }
    render(<AiCheckAccuracy />)
    await waitFor(() => expect(screen.getAllByTestId('ai-check-accuracy-row')).toHaveLength(6))
    expect(rpc).toHaveBeenCalledWith('ai_check_accuracy')
    const partial = screen.getAllByTestId('ai-check-accuracy-row').find(r => r.dataset.key === 'partial_equal')!
    expect(within(partial).getByText('частично, ответ совпал')).toBeInTheDocument()
    expect(partial).toHaveTextContent('20 · 87 %')
    expect(screen.getByTestId('ai-check-accuracy-totals')).toHaveTextContent('336 заданий · зелёных 70 % · правок в зелёных: 11')
  })

  it('миграция не применена — спокойное сообщение, а не красная ошибка', async () => {
    rpcResult = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.ai_check_accuracy' } }
    render(<AiCheckAccuracy />)
    expect(await screen.findByTestId('ai-check-accuracy-error')).toHaveTextContent('Отчёт появится после применения миграции §238.')
  })

  it('за неделю нечего считать', async () => {
    rpcResult = { data: [], error: null }
    render(<AiCheckAccuracy />)
    expect(await screen.findByTestId('ai-check-accuracy-empty')).toBeInTheDocument()
  })
})
