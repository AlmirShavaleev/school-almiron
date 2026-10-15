import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CourseRoadmapCard } from '../CourseRoadmapCard'
import { EMPTY_COUNTERS } from '@/lib/studentCourseCounters'
import type { RoadmapModuleIn, RoadmapTopicIn } from '@/lib/courseRoadmap'

/** «Календарь тем» в программе курса: текущий раздел развёрнут, остальные — по клику. */
const t = (id: string, extra: Partial<RoadmapTopicIn> = {}): RoadmapTopicIn =>
  ({ id, title: `Тема ${id}`, is_open: true, available_from: null, hw_id: `hw-${id}`, hw_status: 'not_started', ...extra })
const modules: RoadmapModuleIn[] = [
  { id: 'm1', title: 'Математика для физики', topics: [t('a', { hw_status: 'accepted' })], counters: { ...EMPTY_COUNTERS, doneTopics: 1, countedTopics: 1 } },
  { id: 'm2', title: 'Кинематика', topics: [t('b'), t('c', { progress: { open: false, note: 'Доступно по подписке' } })], counters: { ...EMPTY_COUNTERS, countedTopics: 2 } },
]

function renderCard(demo: boolean) {
  return render(<MemoryRouter><CourseRoadmapCard modules={modules} groupId="g1" demo={demo} /></MemoryRouter>)
}

describe('CourseRoadmapCard', () => {
  it('текущий раздел развёрнут: «сдать ДЗ» — ссылка в урок, закрытая — с условием', () => {
    renderCard(false)
    const [done, cur] = screen.getAllByTestId('roadmap-module')
    expect(done).toHaveAttribute('data-state', 'done')
    expect(within(done).getByText('готово')).toBeInTheDocument()
    expect(within(done).queryByTestId('roadmap-topic')).toBeNull()
    expect(within(cur).getByRole('link', { name: /Тема b.*сдать ДЗ/ })).toHaveAttribute('href', '/my-course/g1/topic/b')
    expect(within(cur).getByText('Доступно по подписке')).toBeInTheDocument()
    expect(screen.queryByTestId('roadmap-subscribe')).toBeNull()
  })

  it('свёрнутый раздел раскрывается по клику', () => {
    renderCard(false)
    const done = screen.getAllByTestId('roadmap-module')[0]
    fireEvent.click(within(done).getByRole('button'))
    expect(within(done).getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(within(done).getByText('пройдено тем: 1')).toBeInTheDocument()
  })

  it('пробный период — «Оформить подписку»', () => {
    renderCard(true)
    expect(screen.getByTestId('roadmap-subscribe')).toHaveAttribute('href', '/courses')
  })
})
