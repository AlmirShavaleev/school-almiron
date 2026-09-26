/**
 * §221. Настройка пробника-урока: ключ первой части вставляется строкой или
 * столбцом из Excel и уходит одной функцией `save_mock_exam_key` (она же
 * перепроверяет законченные бланки); окно пишется в `mock_exams` по Москве.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const TEMPLATE = { id: 't1', title: 'ЕГЭ математика, профиль', subject: 'math', exam_type: 'ege', year: 2027, max_points: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2, 2, 3, 4, 4], part1_last: 12, score_scale: null }
let rpcCalls: { fn: string; args: Record<string, unknown> }[]
let updates: Record<string, unknown>[]

function thenable<T>(value: T) {
  const chain: Record<string, unknown> = {
    select: () => chain, eq: () => chain, order: () => chain,
    update: (row: Record<string, unknown>) => { updates.push(row); return chain },
    maybeSingle: () => Promise.resolve(value),
    then: (res: (v: T) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(value).then(res, rej),
  }
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'mock_exams') {
        return thenable({ data: {
          id: 'ex1', title: 'Пробник №3', date: '2026-10-18', group_id: 'g1', template_id: 't1', module_id: 'm1', module_position: 2,
          starts_at: '2026-10-18T07:00:00.000Z', duration_minutes: 240, photo_grace_minutes: 15, condition_path: null, solution_path: null,
          groups: { name: '11А', course_id: 'c1' }, mock_exam_templates: TEMPLATE,
        }, error: null })
      }
      if (table === 'mock_exam_answer_keys') return thenable({ data: null, error: null })
      if (table === 'mock_exam_task_scores') return thenable({ data: [], error: null })
      if (table === 'mock_exam_templates') return thenable({ data: [TEMPLATE], error: null })
      throw new Error(`неожиданная таблица ${table}`)
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: { not_checkable: [12], grade: { changed_cells: 7, graded_students: 3 } }, error: null })
    },
  },
}))

import { MockExamSetupPage } from '@/pages/MockExamSetupPage'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/mock-exams/ex1/setup']}>
      <Routes><Route path="/mock-exams/:id/setup" element={<MockExamSetupPage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => { rpcCalls = []; updates = [] })

describe('настройка пробника-урока', () => {
  it('ключ строкой из Excel раскладывается по полям с того, куда вставили, и уходит одной функцией', async () => {
    mount()
    const inputs = await screen.findAllByTestId('mock-setup-key-input')
    expect(inputs).toHaveLength(12)
    fireEvent.paste(inputs[0], { clipboardData: { getData: () => '12\t0,75\t-3\t49\t0,2\t6\t27\t5\t3\t144\t0,25\tчетыре\n' } })
    expect((inputs[1] as HTMLInputElement).value).toBe('0,75')
    expect((inputs[11] as HTMLInputElement).value).toBe('четыре')
    await act(async () => { fireEvent.click(screen.getByTestId('mock-setup-key-save')) })
    await waitFor(() => expect(rpcCalls).toHaveLength(1))
    expect(rpcCalls[0].fn).toBe('save_mock_exam_key')
    expect((rpcCalls[0].args.p_answers as string[]).slice(0, 3)).toEqual(['12', '0,75', '-3'])
    expect(screen.getByTestId('mock-setup-key-status')).toHaveTextContent('Не поддаются автопроверке: №12')
  })

  it('столбцом — со второго поля', async () => {
    mount()
    const inputs = await screen.findAllByTestId('mock-setup-key-input')
    fireEvent.paste(inputs[1], { clipboardData: { getData: () => '7\r\n8\r\n9\r\n' } })
    expect([1, 2, 3].map(i => (inputs[i] as HTMLInputElement).value)).toEqual(['7', '8', '9'])
    expect((inputs[0] as HTMLInputElement).value).toBe('')
  })

  it('§224: окно по Москве; полей «Раздел» и «Место в разделе» нет, подсказка — раздел «Пробники» группы', async () => {
    mount()
    expect(await screen.findByTestId('mock-setup-start')).toHaveValue('2026-10-18T10:00')
    expect(screen.queryByTestId('mock-setup-module')).toBeNull()
    expect(screen.queryByTestId('mock-setup-position')).toBeNull()
    expect(screen.queryByText('Место в разделе')).toBeNull()
    expect(screen.getByTestId('mock-setup-start-hint')).toHaveTextContent('Появится у группы 11А в разделе «Пробники»')
    fireEvent.change(screen.getByTestId('mock-setup-start'), { target: { value: '2026-10-19T09:30' } })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-setup-save')) })
    await waitFor(() => expect(updates).toHaveLength(1))
    expect(updates[0]).toMatchObject({ starts_at: '2026-10-19T06:30:00.000Z', duration_minutes: 240, date: '2026-10-19T06:30:00.000Z' })
    // Привязку к разделу экран больше не пишет — ни значением, ни null.
    expect(updates[0]).not.toHaveProperty('module_id')
    expect(updates[0]).not.toHaveProperty('module_position')
  })
})
