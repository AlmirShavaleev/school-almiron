import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

/**
 * §210. Форма вердикта в своей колонке.
 *
 * Смысл проверки один: таблица (`above`) прокручивается сама, а комментарий,
 * балл и кнопки остаются внизу колонки. До этого таблица и форма шли одним
 * куском под работой, и до «Принять» в конце каждой работы приходилось
 * мотать вниз.
 */

const attempt = {
  id: 'a1',
  homework_id: 'h1',
  student_id: 's1',
  attempt_number: 1,
  status: 'submitted',
  submitted_at: '2026-09-17T09:00:00Z',
  created_at: '2026-09-17T08:00:00Z',
  updated_at: '2026-09-17T09:00:00Z',
} as unknown as TopicHomeworkAttemptRow

const table = <div data-testid="fake-table">таблица проверки</div>

function renderForm(columnLayout: boolean) {
  return render(
    <ReviewActions
      attempt={attempt}
      gradeScale="five"
      onReview={async () => {}}
      above={table}
      columnLayout={columnLayout}
    />,
  )
}

describe('форма вердикта в колонке', () => {
  it('кнопки стоят ВНЕ прокручиваемой части — таблица едет, решение остаётся', () => {
    renderForm(true)
    const above = screen.getByTestId('review-actions-above')

    expect(above.contains(screen.getByTestId('fake-table'))).toBe(true)
    expect(above.contains(screen.getByTestId('review-accept-button'))).toBe(false)
    expect(above.contains(screen.getByTestId('review-return-button'))).toBe(false)
    expect(above.contains(screen.getByTestId('review-comment-input'))).toBe(false)
    expect(above.className).toContain('overflow-y-auto')
  })

  it('без колонки всё как было — один поток, отдельного свитка у таблицы нет', () => {
    renderForm(false)
    const above = screen.getByTestId('review-actions-above')

    expect(above.contains(screen.getByTestId('fake-table'))).toBe(true)
    expect(above.className).not.toContain('overflow-y-auto')
    expect(screen.getByTestId('review-actions').className).not.toContain('h-full')
  })

  it('содержимое формы от раскладки не зависит', () => {
    renderForm(true)
    expect(screen.getByTestId('review-comment-input')).toBeInTheDocument()
    expect(screen.getByTestId('review-score-input')).toBeInTheDocument()
    expect(screen.getByTestId('review-accept-button')).toBeInTheDocument()
    expect(screen.getByTestId('review-return-button')).toBeInTheDocument()
  })
})
