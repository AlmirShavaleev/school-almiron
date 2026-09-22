/**
 * §213. «Переписать по таблице» в форме вердикта (board/064).
 *
 * Проверяется ровно то, что стоит дорого: результат НЕ затирает поле молча.
 * В поле лежит текст преподавателя — он мог дописать своё уже после нажатия,
 * и подмена без спроса означала бы потерю его работы.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const rewriteCommentByTable = vi.fn()
vi.mock('@/lib/rewriteComment', () => ({
  rewriteCommentByTable: (...args: unknown[]) => rewriteCommentByTable(...args),
}))

import { ReviewActions } from '@/components/courseProgram/TopicHomeworkReview'
import type { TopicHomeworkAttemptRow } from '@/lib/topicHomework'

const attempt = {
  id: 'att-1',
  homework_id: 'h1',
  student_id: 's1',
  attempt_number: 1,
  status: 'submitted',
  submitted_at: '2026-09-21T09:00:00Z',
  created_at: '2026-09-21T08:00:00Z',
  updated_at: '2026-09-21T09:00:00Z',
} as unknown as TopicHomeworkAttemptRow

const REWRITTEN = 'В заданиях 3 и 5 всё верно. Осталось задание 7 — там потерян второй корень.'

function renderForm(props: Record<string, unknown> = {}) {
  return render(
    <ReviewActions
      attempt={attempt}
      gradeScale="five"
      onReview={async () => {}}
      canRewriteComment
      {...props}
    />,
  )
}

const field = () => screen.getByTestId('review-comment-input') as HTMLTextAreaElement
const button = () => screen.getByTestId('review-rewrite-button')

beforeEach(() => {
  rewriteCommentByTable.mockReset()
  rewriteCommentByTable.mockResolvedValue({ text: REWRITTEN, model: 'test-model', usage: null })
})

describe('§213 — кнопка', () => {
  it('есть, когда таблица непустая', () => {
    renderForm()
    expect(button()).toBeInTheDocument()
  })

  it('нет, когда таблицы нет: переписывать не из чего', () => {
    renderForm({ canRewriteComment: false })
    expect(screen.queryByTestId('review-rewrite-button')).not.toBeInTheDocument()
  })

  it('нет, когда вердикт вообще заблокирован (§198)', () => {
    renderForm({ disabledReason: 'Это не последняя попытка' })
    expect(screen.queryByTestId('review-rewrite-button')).not.toBeInTheDocument()
  })

  it('зовёт функцию по этой работе и показывает «Пишу…»', async () => {
    let release: (value: unknown) => void = () => {}
    rewriteCommentByTable.mockReturnValue(new Promise(done => { release = done }))
    renderForm()

    fireEvent.click(button())

    expect(rewriteCommentByTable).toHaveBeenCalledWith('att-1')
    expect(button()).toBeDisabled()
    expect(button().textContent).toContain('Пишу')

    release({ text: REWRITTEN, model: 'm', usage: null })
    await waitFor(() => expect(button()).not.toBeDisabled())
  })
})

describe('§213 — результат предложением, а не подменой', () => {
  it('текст появляется предложением, а поле остаётся нетронутым', async () => {
    renderForm()
    fireEvent.change(field(), { target: { value: 'Мой текст' } })

    fireEvent.click(button())

    await screen.findByTestId('review-rewrite-suggestion')
    expect(screen.getByTestId('review-rewrite-suggestion-text').textContent).toBe(REWRITTEN)
    // Самое главное: то, что человек написал, на месте.
    expect(field().value).toBe('Мой текст')
  })

  it('«Вставить» заменяет текст и убирает предложение', async () => {
    renderForm()
    fireEvent.change(field(), { target: { value: 'Мой текст' } })
    fireEvent.click(button())
    await screen.findByTestId('review-rewrite-suggestion')

    fireEvent.click(screen.getByTestId('review-rewrite-apply'))

    expect(field().value).toBe(REWRITTEN)
    expect(screen.queryByTestId('review-rewrite-suggestion')).not.toBeInTheDocument()
  })

  it('«Отмена» не трогает поле и убирает предложение', async () => {
    renderForm()
    fireEvent.change(field(), { target: { value: 'Мой текст' } })
    fireEvent.click(button())
    await screen.findByTestId('review-rewrite-suggestion')

    fireEvent.click(screen.getByTestId('review-rewrite-cancel'))

    expect(field().value).toBe('Мой текст')
    expect(screen.queryByTestId('review-rewrite-suggestion')).not.toBeInTheDocument()
  })

  it('пустое поле «Вставить» заполняет — это тот же путь, не особый', async () => {
    renderForm()
    fireEvent.click(button())
    await screen.findByTestId('review-rewrite-suggestion')

    fireEvent.click(screen.getByTestId('review-rewrite-apply'))

    expect(field().value).toBe(REWRITTEN)
  })

  it('повторное нажатие даёт новое предложение вместо старого', async () => {
    renderForm()
    fireEvent.click(button())
    await screen.findByTestId('review-rewrite-suggestion')

    rewriteCommentByTable.mockResolvedValue({ text: 'Второй вариант', model: 'm', usage: null })
    fireEvent.click(button())

    await waitFor(() => {
      expect(screen.getByTestId('review-rewrite-suggestion-text').textContent).toBe('Второй вариант')
    })
  })
})

describe('§213 — отказ', () => {
  it('ошибка видна текстом функции и поле не тронуто', async () => {
    rewriteCommentByTable.mockRejectedValue(new Error('Таблица проверки пуста — переписывать комментарий не из чего'))
    renderForm()
    fireEvent.change(field(), { target: { value: 'Мой текст' } })

    fireEvent.click(button())

    const error = await screen.findByTestId('review-rewrite-error')
    expect(error.textContent).toContain('Таблица проверки пуста')
    expect(field().value).toBe('Мой текст')
    expect(screen.queryByTestId('review-rewrite-suggestion')).not.toBeInTheDocument()
  })

  it('следующая удачная попытка убирает прежнюю ошибку', async () => {
    rewriteCommentByTable.mockRejectedValue(new Error('Модель ответила ошибкой 502'))
    renderForm()
    fireEvent.click(button())
    await screen.findByTestId('review-rewrite-error')

    rewriteCommentByTable.mockResolvedValue({ text: REWRITTEN, model: 'm', usage: null })
    fireEvent.click(button())

    await screen.findByTestId('review-rewrite-suggestion')
    expect(screen.queryByTestId('review-rewrite-error')).not.toBeInTheDocument()
  })
})
