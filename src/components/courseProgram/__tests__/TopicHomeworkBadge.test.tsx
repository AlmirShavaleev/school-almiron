import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopicHomeworkBadge } from '@/components/courseProgram/TopicHomeworkBadge'

/**
 * §117. В строке темы было видно только «Открыта/Закрыта», а есть ли ДЗ —
 * приходилось проваливаться в модалку. Три состояния должны различаться
 * честно, и дедлайн не должен появляться там, где он ничего не значит.
 */
describe('TopicHomeworkBadge', () => {
  it('ДЗ не создано', () => {
    render(<TopicHomeworkBadge rows={[]} />)

    expect(screen.getByTestId('topic-homework-state-none')).toHaveTextContent('ДЗ нет')
    expect(screen.queryByTestId('topic-homework-due')).not.toBeInTheDocument()
  })

  it('черновик отличается от выданного ученикам', () => {
    render(<TopicHomeworkBadge rows={[{ topic_id: 't1', is_published: false, due_at: '2026-09-14' }]} />)

    expect(screen.getByTestId('topic-homework-state-draft')).toHaveTextContent('ДЗ черновик')
    // Дедлайн черновика ничего не значит: ученик задания ещё не видит.
    expect(screen.queryByTestId('topic-homework-due')).not.toBeInTheDocument()
  })

  it('опубликованное показывает дедлайн', () => {
    render(<TopicHomeworkBadge rows={[{ topic_id: 't1', is_published: true, due_at: '2026-09-14' }]} />)

    expect(screen.getByTestId('topic-homework-state-published')).toBeInTheDocument()
    expect(screen.getByTestId('topic-homework-due')).toHaveTextContent('до 14 сентября')
  })

  /** Пустое место честнее прочерка: «—» читается как «не загрузилось». */
  it('опубликованное без дедлайна не рисует заглушку', () => {
    render(<TopicHomeworkBadge rows={[{ topic_id: 't1', is_published: true, due_at: null }]} />)

    expect(screen.getByTestId('topic-homework-state-published')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-homework-due')).not.toBeInTheDocument()
  })

  it('состояние объясняется подсказкой, а не только цветом', () => {
    render(<TopicHomeworkBadge rows={[{ topic_id: 't1', is_published: false, due_at: null }]} />)

    expect(screen.getByTestId('topic-homework-state-draft'))
      .toHaveAttribute('title', 'ДЗ создано, но не выдано ученикам')
  })
})
