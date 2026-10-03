import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useCartStore } from '@/store/cartStore'

/**
 * §262. PDF ученика из корзины: ответы задач, которые ему ещё не положены,
 * в данных отсутствуют — в PDF их нет. «Открыть ответы для PDF» — раскрытие
 * на сервере пачкой (catalog_reveal_answers), после него ответы в PDF есть.
 * Подменены загрузчик корзины, панель печати (смотрим, ЧТО ей передано) и
 * транспорт supabase.
 */
const net = vi.hoisted(() => ({ calls: [] as Array<[string, Record<string, unknown> | undefined]>, fail: false }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      net.calls.push([fn, args])
      if (net.fail) return Promise.resolve({ data: null, error: { message: 'сеть' } })
      return Promise.resolve({ data: (args!.p_task_ids as string[]).map(id => ({
        task_id: id, allowed: true, reason: 'revealed', answer_html: `<p>ответ ${id}</p>`, solution_html: `<p>решение ${id}</p>`,
        solution_plan_html: null, grade_criteria_html: null, has_plan: false, has_criteria: false,
      })), error: null })
    },
  },
}))

const base = { section_id: 's', subject: 'Математика', exam_type: 'ЕГЭ', has_answer: true, has_solution: true, exam_part: 1, assets: [], solution_plan_html: null, grade_criteria_html: null }
vi.mock('@/hooks/useCatalog', () => ({
  useCatalogTasksBatch: () => ({
    loading: false,
    error: null,
    tasks: [
      { ...base, id: 'open', external_id: 1, position: 1, statement_html: '<p>open</p>', answer_html: '<p>7</p>', solution_html: '<p>x = 7</p>', answers_locked: false },
      { ...base, id: 'closed', external_id: 2, position: 2, statement_html: '<p>closed</p>', answer_html: null, solution_html: null, answers_locked: true },
    ],
  }),
}))
vi.mock('@/components/catalog/TaskDisplayCard', () => ({ TaskDisplayCard: () => null }))
const panel = vi.fn()
vi.mock('@/components/pdf/VariantPrintPanel', () => ({
  VariantPrintPanel: (props: { items: Array<{ task: { id: string; answer_html: string | null } }> }) => { panel(props); return <div data-testid="panel" /> },
}))

import { StudentVariantBuildPage } from '@/pages/student/StudentVariantBuildPage'

const answersInPdf = () => {
  const items = (panel.mock.calls.at(-1)![0] as { items: Array<{ task: { id: string; answer_html: string | null } }> }).items
  return Object.fromEntries(items.map(i => [i.task.id, i.task.answer_html]))
}

beforeEach(() => {
  net.calls = []
  net.fail = false
  panel.mockReset()
  useCartStore.setState({ items: [] })
  useCartStore.getState().addItem('open')
  useCartStore.getState().addItem('closed')
})

describe('PDF ученика — закрытые ответы (§262)', () => {
  it('закрытого ответа в PDF нет; подсказка с числом задач; открытие — пачкой на сервере, потом ответ в PDF', async () => {
    render(<MemoryRouter><StudentVariantBuildPage /></MemoryRouter>)
    expect(answersInPdf()).toEqual({ open: '<p>7</p>', closed: null })
    expect(screen.getByTestId('pdf-locked-answers')).toHaveTextContent('Ответы к 1 задаче ещё не открыты')
    expect(screen.getByTestId('pdf-locked-answers')).toHaveTextContent('не принесут баллов школы')
    expect(net.calls).toEqual([])

    await act(async () => { fireEvent.click(screen.getByTestId('pdf-open-answers')) })
    expect(net.calls).toEqual([['catalog_reveal_answers', { p_task_ids: ['closed'] }]])
    expect(answersInPdf()).toEqual({ open: '<p>7</p>', closed: '<p>ответ closed</p>' })
    expect(screen.queryByTestId('pdf-locked-answers')).toBeNull()
  })

  it('ошибка сервера — текст ошибки, ответы по-прежнему закрыты', async () => {
    net.fail = true
    render(<MemoryRouter><StudentVariantBuildPage /></MemoryRouter>)
    await act(async () => { fireEvent.click(screen.getByTestId('pdf-open-answers')) })
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось открыть ответы')
    expect(answersInPdf().closed).toBeNull()
  })
})
