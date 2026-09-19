import { describe, expect, it, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import { COMMENT_ROWS } from '@/lib/reviewCommentBox'
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

/**
 * §208. Поле комментария в форме вердикта.
 *
 * Владелец: «окно для комментариев не увеличивается, поэтому тяжело что-либо
 * туда писать». Он не пишет с нуля, а ПРАВИТ подставленный разбор ИИ — значит
 * высота обязана считаться и от программной подстановки тоже.
 *
 * В jsdom нет раскладки, поэтому `scrollHeight` (сколько занял бы текст)
 * задаётся тестом: это единственная величина, которую браузер посчитал бы сам,
 * всё остальное — настоящее поведение компонента.
 */

let contentHeight = 0

beforeEach(() => {
  contentHeight = 0
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => contentHeight,
  })
  window.innerHeight = 800
})

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

function form(fillRequest?: { comment?: string } | null) {
  return render(<ReviewActions attempt={attempt} onReview={async () => {}} fillRequest={fillRequest} />)
}

const box = () => screen.getByTestId('review-comment-input') as HTMLTextAreaElement

describe('ReviewActions — поле комментария', () => {
  it('стартует заметно выше двух строк', () => {
    form()
    expect(box().rows).toBe(COMMENT_ROWS)
    expect(box().rows).toBeGreaterThanOrEqual(5)
  })

  it('растёт под набранный текст', () => {
    form()
    contentHeight = 210
    fireEvent.change(box(), { target: { value: 'длинный разбор\n'.repeat(8) } })
    expect(box().style.height).toBe('210px')
    expect(box().style.overflowY).toBe('hidden')
  })

  it('упирается в потолок и дальше прокручивается', () => {
    form()
    contentHeight = 2000
    fireEvent.change(box(), { target: { value: 'очень длинный разбор' } })
    // 40 % высоты панели: кнопки «Принять» и «Вернуть» обязаны остаться на виду.
    expect(box().style.height).toBe('320px')
    expect(box().style.overflowY).toBe('auto')
  })

  it('подставленный программно разбор ИИ тоже увеличивает поле', () => {
    const { rerender } = form(null)
    expect(box().style.height).toBe('0px')

    contentHeight = 260
    rerender(
      <ReviewActions
        attempt={attempt}
        onReview={async () => {}}
        fillRequest={{ comment: 'Разбор ИИ: задание 3 — ошибка в знаке…' }}
      />,
    )

    expect(box().value).toContain('Разбор ИИ')
    expect(box().style.height).toBe('260px')
  })

  it('растянутое руками поле авто-рост не трогает', () => {
    form()
    // Уголок изменения размера пишет высоту в inline-стиль — воспроизводим это.
    box().style.height = '420px'

    contentHeight = 120
    fireEvent.change(box(), { target: { value: 'ещё текст' } })

    expect(box().style.height).toBe('420px')
  })
})
