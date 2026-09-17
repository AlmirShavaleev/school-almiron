import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// resolveTaskHtml ходит в Supabase Storage за URL картинок — для разметки
// печати это несущественно, подставляем html как есть.
vi.mock('@/utils/resolveTaskHtml', () => ({
  resolveTaskHtml: (html: string | null | undefined) => html ?? '',
}))

import { VariantDocument } from '@/components/pdf/VariantDocument'
import { DEFAULT_VARIANT_PRINT_SETTINGS, type VariantPrintSettings } from '@/types/variantPrint'
import type { PrintableItem, PrintableTask } from '@/utils/variantPrintUtils'

/**
 * §201: у задач части 2 своего ответа нет — в печати вместо «Ответ не указан»
 * должны стоять максимум баллов и критерии оценивания, по которым задачу и
 * проверяют.
 */

function makeTask(overrides: Partial<PrintableTask> = {}): PrintableTask {
  return {
    id: 'task-1',
    external_id: 13001,
    section_id: 'sec-1',
    subject: 'Математика',
    exam_type: 'ЕГЭ',
    statement_html: '<p>Решите уравнение</p>',
    answer_html: null,
    solution_html: null,
    solution_plan_html: null,
    grade_criteria_html: null,
    source_url: null,
    has_answer: false,
    has_solution: false,
    position: 1,
    assets: [],
    ...overrides,
  } as PrintableTask
}

const part2 = makeTask({
  exam_part: 2,
  has_answer: false,
  answer_html: null,
  grade_criteria_html: '<p>Обоснованно получен верный ответ — 2 балла</p>',
  max_points: 2,
})

const part1 = makeTask({
  id: 'task-2',
  exam_part: 1,
  has_answer: true,
  answer_html: '<p>42</p>',
  max_points: 1,
})

function items(...tasks: PrintableTask[]): PrintableItem[] {
  return tasks.map((task, i) => ({ id: `item-${i + 1}`, task }))
}

function settings(overrides: Partial<VariantPrintSettings> = {}): VariantPrintSettings {
  return { ...DEFAULT_VARIANT_PRINT_SETTINGS, showAnswers: true, ...overrides }
}

describe('VariantDocument — часть 2 в печати', () => {
  it('вместо «Ответ не указан» печатает максимум баллов и критерии', () => {
    render(<VariantDocument items={items(part2)} settings={settings()} />)

    expect(screen.queryByText('Ответ не указан')).toBeNull()
    expect(screen.getByText('Развёрнутый ответ. Максимум 2 балла')).toBeInTheDocument()
    expect(screen.getByText('Критерии оценивания')).toBeInTheDocument()
    expect(screen.getByText(/Обоснованно получен верный ответ/)).toBeInTheDocument()
  })

  it('при выключенных ответах ни критериев, ни подписи о баллах нет', () => {
    render(<VariantDocument items={items(part2)} settings={settings({ showAnswers: false })} />)

    expect(screen.queryByText('Критерии оценивания')).toBeNull()
    expect(screen.queryByText(/Обоснованно получен верный ответ/)).toBeNull()
    expect(screen.queryByText(/Развёрнутый ответ/)).toBeNull()
    // Условие при этом на месте — выключены именно ответы.
    expect(screen.getByText('Решите уравнение')).toBeInTheDocument()
  })

  it('режим «рабочий лист» ответы и критерии тоже не печатает', () => {
    render(<VariantDocument items={items(part2)} settings={settings({ mode: 'worksheet' })} />)

    expect(screen.queryByText('Критерии оценивания')).toBeNull()
    expect(screen.queryByText(/Развёрнутый ответ/)).toBeNull()
  })

  it('без критериев остаётся честное «Ответ не указан»', () => {
    const noCriteria = makeTask({ id: 'task-3', exam_part: 2, has_answer: false, max_points: 3 })
    render(<VariantDocument items={items(noCriteria)} settings={settings()} />)

    expect(screen.getByText('Ответ не указан')).toBeInTheDocument()
    expect(screen.queryByText(/Развёрнутый ответ/)).toBeNull()
  })

  it('у задачи части 1 ответ печатается как раньше', () => {
    render(<VariantDocument items={items(part1)} settings={settings()} />)

    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.queryByText('Ответ не указан')).toBeNull()
    expect(screen.queryByText(/Развёрнутый ответ/)).toBeNull()
    expect(screen.queryByText('Критерии оценивания')).toBeNull()
  })

  it('в сводной таблице ответов у части 2 стоит «разв.», а не пустая клетка', () => {
    render(
      <VariantDocument items={items(part1, part2)} settings={settings({ showKey: true })} />,
    )

    const rows = screen.getAllByRole('row').slice(1) // без шапки
    const cells = rows.map(r => [...r.querySelectorAll('td')].map(td => td.textContent))
    expect(cells).toEqual([
      ['1', '42'],
      ['2', 'разв., 2 б.'],
    ])
  })
})
