import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

/**
 * §211. Форма вердикта в своей колонке — в ПОТОКЕ, за таблицей.
 *
 * §210 прижимал комментарий, балл и кнопки к низу колонки и отдавал таблице
 * отдельный свиток над ними. Владелец посмотрел вживую и попросил иначе:
 * блок стоит внизу колонки, за таблицей, и доезжает прокруткой — те самые
 * 60–70 px возвращаются таблице. Прокручивается колонка целиком, поэтому
 * своего свитка внутри формы больше нет ни в одной раскладке.
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
  it('таблица и вердикт идут одним потоком: отдельного свитка у таблицы нет', () => {
    renderForm(true)
    const above = screen.getByTestId('review-actions-above')

    expect(above.contains(screen.getByTestId('fake-table'))).toBe(true)
    expect(above.className).not.toContain('overflow-y-auto')
    // Ничего не прижато к низу: панель не превращается в колонку высотой
    // во всю доступную высоту с двумя частями.
    expect(screen.getByTestId('review-actions').className).not.toContain('h-full')
  })

  it('вердикт стоит ЗА таблицей — значит доезжает прокруткой колонки', () => {
    renderForm(true)
    const panel = screen.getByTestId('review-actions')
    const above = screen.getByTestId('review-actions-above')
    const accept = screen.getByTestId('review-accept-button')

    expect(above.contains(accept)).toBe(false)
    // DOCUMENT_POSITION_FOLLOWING: кнопка идёт в разметке ПОСЛЕ таблицы.
    expect(above.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(panel.contains(above)).toBe(true)
    expect(panel.contains(accept)).toBe(true)
  })

  it('без колонки всё как было — один поток и отступ сверху', () => {
    renderForm(false)
    const above = screen.getByTestId('review-actions-above')

    expect(above.contains(screen.getByTestId('fake-table'))).toBe(true)
    expect(above.className).not.toContain('overflow-y-auto')
    expect(screen.getByTestId('review-actions').className).toContain('mt-3')
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
