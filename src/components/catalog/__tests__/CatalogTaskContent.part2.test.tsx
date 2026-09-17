import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Ссылки на картинки в Storage для этой проверки неважны.
vi.mock('@/hooks/useCatalog', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useCatalog')>('@/hooks/useCatalog')
  return { ...actual, getAssetUrl: (p: string) => p, safeDecodeStoragePath: (p: string) => p }
})

import { CatalogTaskContent } from '@/components/catalog/CatalogTaskContent'
import type { CatalogTask } from '@/hooks/useCatalog'

/**
 * §201: у задачи части 2 кнопки «Ответ» нет вовсе, и ряд кнопок без неё
 * читается как «задача недогрузилась». Подпись объясняет, что ответа тут и
 * не должно быть.
 */
function makeTask(overrides: Partial<CatalogTask> = {}): CatalogTask {
  return {
    id: 'task-1',
    external_id: 13001,
    section_id: 'sec-1',
    subject: 'Математика',
    exam_type: 'ЕГЭ',
    statement_html: '<p>Решите уравнение</p>',
    answer_html: null,
    solution_html: '<p>Решение</p>',
    solution_plan_html: null,
    grade_criteria_html: null,
    has_answer: false,
    has_solution: true,
    position: 1,
    exam_part: 2,
    assets: [],
    ...overrides,
  } as CatalogTask
}

describe('CatalogTaskContent — подпись у задач части 2', () => {
  it('показывает подпись с максимумом баллов, когда ответа нет, а критерии есть', () => {
    render(<CatalogTaskContent task={makeTask({ grade_criteria_html: '<p>Критерии</p>', max_points: 3 })} />)

    expect(screen.getByTestId('task-extended-answer-note').textContent)
      .toBe('Ответ развёрнутый — см. критерии, максимум 3 балла')
  })

  it('без max_points подпись не выдумывает балл', () => {
    render(<CatalogTaskContent task={makeTask({ grade_criteria_html: '<p>Критерии</p>', max_points: null })} />)

    expect(screen.getByTestId('task-extended-answer-note').textContent)
      .toBe('Ответ развёрнутый — см. критерии')
  })

  it('у задачи с ответом подписи нет', () => {
    render(<CatalogTaskContent task={makeTask({
      exam_part: 1, has_answer: true, answer_html: '<p>42</p>',
      grade_criteria_html: '<p>Критерии</p>', max_points: 1,
    })} />)

    expect(screen.queryByTestId('task-extended-answer-note')).toBeNull()
  })

  it('у задачи без критериев подписи нет', () => {
    render(<CatalogTaskContent task={makeTask({ max_points: 3 })} />)

    expect(screen.queryByTestId('task-extended-answer-note')).toBeNull()
  })

  it('без showControls (кнопок нет) подписи тоже нет', () => {
    render(
      <CatalogTaskContent
        task={makeTask({ grade_criteria_html: '<p>Критерии</p>', max_points: 3 })}
        showControls={false}
      />,
    )

    expect(screen.queryByTestId('task-extended-answer-note')).toBeNull()
  })
})
