import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LessonCard, type LessonCardData } from '@/components/courseProgram/LessonCard'
import type { TopicSection } from '@/lib/topicMaterialItems'

/** §274. Карточка урока: превью, плашки, строка срока, ссылка/замок. */

const TODAY = '2026-10-08'

const data = (over: Partial<LessonCardData> = {}): LessonCardData => ({
  id: 't1', title: 'Законы Ньютона', kind: 'lesson',
  is_open: true, available_from: null, sections: new Set<TopicSection>(['video', 'theory']),
  hw_id: 'hw1', hw_due_at: '2026-10-09', hw_status: 'not_started', hw_score: null, hw_max: null,
  test_assignment_id: null, test_status: null, tasks_total: 7, tasks_closed: 3,
  ...over,
})

function renderCard(topic: LessonCardData, thumbnailUrl: string | null = null) {
  return render(
    <MemoryRouter>
      <LessonCard topic={topic} index={2} href="/my-course/g1/topic/t1" today={TODAY} openToday={TODAY} thumbnailUrl={thumbnailUrl} />
    </MemoryRouter>,
  )
}

describe('LessonCard', () => {
  it('типичный урок: «Урок 3», плашки, «ДЗ до пт, 9 окт», задачи 3/7, вся карточка — ссылка', () => {
    renderCard(data())
    const card = screen.getByTestId('lesson-card')
    expect(card.tagName).toBe('A')
    expect(card).toHaveAttribute('href', '/my-course/g1/topic/t1')
    expect(card).toHaveAccessibleName('Урок 3: Законы Ньютона. ДЗ до пт, 9 окт')
    expect(card).toHaveTextContent('Урок 3')
    expect(screen.getByTestId('lesson-chips')).toHaveTextContent('ВидеоТеорияЗадачи · 7ДЗ')
    expect(screen.getByTestId('lesson-status')).toHaveAttribute('data-tone', 'todo')
    expect(screen.getByRole('progressbar', { name: 'Задачи к уроку' })).toHaveAttribute('aria-valuenow', '3')
    expect(card).toHaveTextContent('3/7')
  })

  it('без обложки — заглушка с номером; обложка не загрузилась — тоже заглушка', () => {
    const { unmount } = renderCard(data())
    expect(screen.getByTestId('lesson-thumb')).toHaveAttribute('data-kind', 'placeholder')
    expect(screen.getByTestId('lesson-thumb')).toHaveTextContent('3')
    unmount()

    renderCard(data(), 'https://vz-x.b-cdn.net/g/thumbnail.jpg')
    const thumb = screen.getByTestId('lesson-thumb')
    expect(thumb).toHaveAttribute('data-kind', 'video')
    fireEvent.error(thumb.querySelector('img')!)
    expect(thumb).toHaveAttribute('data-kind', 'placeholder')
  })

  it('просроченное ДЗ — красная строка «Просрочено»', () => {
    renderCard(data({ hw_due_at: '2026-10-01' }))
    expect(screen.getByTestId('lesson-status')).toHaveTextContent('Просрочено · срок был 1 окт')
    expect(screen.getByTestId('lesson-status')).toHaveAttribute('data-tone', 'bad')
  })

  it('сдано — «Сдано · на проверке»', () => {
    renderCard(data({ hw_status: 'submitted' }))
    expect(screen.getByTestId('lesson-status')).toHaveTextContent('Сдано · на проверке')
  })

  it('урок откроется по дате: не ссылка, замок, «Откроется 12 окт», без плашек и прогресса', () => {
    renderCard(data({ is_open: null, available_from: '2026-10-12' }), 'https://vz-x.b-cdn.net/g/thumbnail.jpg')
    const card = screen.getByTestId('lesson-card')
    expect(card.tagName).toBe('DIV')
    expect(card).toHaveAttribute('data-locked')
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByTestId('lesson-status')).toHaveTextContent('Откроется 12 окт')
    expect(screen.queryByTestId('lesson-chips')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    // Обложку закрытого урока не показываем — только заглушку с замком.
    expect(screen.getByTestId('lesson-thumb')).toHaveAttribute('data-kind', 'placeholder')
  })
})
