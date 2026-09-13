import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/components/catalog/TaskContentRenderer', () => ({
  TaskContentRenderer: ({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />,
}))
vi.mock('@/utils/resolveTaskHtml', () => ({ resolveTaskHtml: (html: string) => html ?? '' }))

import { TaskDisplayCard } from '@/components/catalog/TaskDisplayCard'
import type { CatalogTask } from '@/hooks/useCatalog'

const task = {
  id: 't1', section_id: 's1', subject: 'Физика', exam_type: 'ЕГЭ', external_id: 124600, position: 1, is_published: true,
  statement_html: '<p>Условие</p>', has_answer: true, has_solution: false, answer_html: '<p>2</p>', solution_html: null,
  solution_plan_html: null, grade_criteria_html: null, difficulty: 'лёгкая', exam_part: 1, max_points: 1, partial_type: null,
  source_url: null, created_at: null, updated_at: null, is_completed: false,
} as unknown as CatalogTask

/**
 * Отметка «выполнено» — подписанная кнопка в ряду действий, а бейдж
 * сложности — обычный элемент строки. Раньше бейдж стоял absolute в углу и
 * ложился ровно на кружок отметки: ученик не понимал, где отмечать (§154).
 */
describe('TaskDisplayCard — отметка «выполнено»', () => {
  it('кнопка подписана и вызывает onToggle', () => {
    const onToggle = vi.fn()
    render(<TaskDisplayCard task={task} number={1} onToggle={onToggle} />)
    const btn = screen.getByRole('button', { name: /Отметить выполненной/ })
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('выполненная задача подписана «Выполнено»', () => {
    render(<TaskDisplayCard task={task} number={1} onToggle={() => {}} completed />)
    const btn = screen.getByRole('button', { name: /Выполнено/ })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('без onToggle кнопки нет', () => {
    render(<TaskDisplayCard task={task} number={1} />)
    expect(screen.queryByTestId('task-complete-toggle')).toBeNull()
  })

  it('бейдж сложности не абсолютный и не закрывает кнопку', () => {
    render(<TaskDisplayCard task={task} number={1} onToggle={() => {}} />)
    const badge = screen.getByTestId('task-difficulty-badge')
    expect(badge.textContent).toBe('лёгкая')
    expect(badge.className.split(/\s+/)).not.toContain('absolute')
  })
})
