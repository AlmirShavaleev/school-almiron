/**
 * §218. Экран шаблона пробника: таблица перевода вставляется столбцом из
 * Excel, неверная длина объясняется словами, преподаватель видит шаблон
 * только для чтения (пишет владелец — так стоят политики базы).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

let role = 'owner'
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'p1', role } }),
}))

const saved: unknown[] = []
const TEMPLATE = { id: 't1', title: 'ЕГЭ математика, профиль', subject: 'math', exam_type: 'ege', year: 2027, max_points: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 2, 2, 3, 4, 4], part1_last: 12, score_scale: null }
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        order: () => Promise.resolve({ data: [TEMPLATE], error: null }),
        update: (row: unknown) => { saved.push(row); return chain },
        insert: (row: unknown) => { saved.push(row); return chain },
        eq: () => chain,
        single: () => Promise.resolve({ data: { id: 't1' }, error: null }),
      }
      return chain
    },
  },
}))

import { MockExamTemplatesPage } from '@/pages/MockExamTemplatesPage'

const open = () => render(<MemoryRouter><MockExamTemplatesPage /></MemoryRouter>)

beforeEach(() => { cleanup(); role = 'owner'; saved.length = 0 })

describe('MockExamTemplatesPage', () => {
  it('раскладка профильной математики: 12 + 20 = 32', async () => {
    open()
    expect((await screen.findByTestId('mock-template-sum')).textContent).toMatch(/первая часть 12 б., вторая 20 б., всего 32/)
  })

  it('таблица перевода столбцом из Excel — 33 строки, уходит в базу массивом', async () => {
    open()
    const area = await screen.findByLabelText('Таблица перевода из Excel')
    const column = Array.from({ length: 33 }, (_, k) => String(Math.round(k * 100 / 32))).join('\r\n') + '\r\n'
    fireEvent.change(area, { target: { value: column } })
    expect(screen.getByTestId('mock-template-scale').textContent).toMatch(/100/)
    fireEvent.click(screen.getByTestId('mock-template-save'))
    await waitFor(() => expect(saved).toHaveLength(1))
    const row = saved[0] as { score_scale: number[] }
    expect(row.score_scale).toHaveLength(33)
    expect(row.score_scale[0]).toBe(0)
    expect(row.score_scale[32]).toBe(100)
  })

  it('не та длина — ошибка словами, таблица не принята', async () => {
    open()
    const area = await screen.findByLabelText('Таблица перевода из Excel')
    fireEvent.change(area, { target: { value: '0\n6\n11' } })
    expect(screen.getByTestId('mock-template-scale-error').textContent).toMatch(/Строк 3, а нужно 33/)
    expect(screen.queryByTestId('mock-template-scale')).toBeNull()
  })

  it('преподаватель — только просмотр: ни поля вставки, ни кнопки сохранения', async () => {
    role = 'teacher'
    open()
    await screen.findByTestId('mock-template-sum')
    expect(screen.queryByTestId('mock-template-save')).toBeNull()
    expect(screen.queryByLabelText('Таблица перевода из Excel')).toBeNull()
    expect((screen.getByLabelText('Максимум за задание 1') as HTMLInputElement).disabled).toBe(true)
  })
})
