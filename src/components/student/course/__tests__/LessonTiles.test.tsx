import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LessonTiles } from '../CourseScreen'
import type { TopicProgress } from '@/hooks/useStudentCourseProgram'
import type { LessonTile } from '@/lib/courseScreen'

const details = {
  sections: new Set(['video', 'notes', 'tasks']), hw_id: 'hw', hw_status: 'not_started',
  hw_due_at: '2020-01-01T12:00:00Z', hw_score: null, hw_max: null,
  tasks_total: 7, tasks_closed: 2, lesson_format: null,
} as Pick<TopicProgress, 'sections' | 'hw_id' | 'hw_status' | 'hw_due_at' | 'hw_score' | 'hw_max' | 'tasks_total' | 'tasks_closed' | 'lesson_format'>
function show(tile: LessonTile, extra = {}) {
  render(<MemoryRouter><LessonTiles lessons={[{ id: 'lesson', title: 'Производная', tile, details: { ...details, ...extra } }]} hrefFor={id => `/lesson/${id}`} /></MemoryRouter>)
}
describe('подробная карточка урока', () => {
  it('показывает только имеющиеся материалы, задачи, срок и переход', () => {
    show({ state: 'hw', pill: 'сдать ДЗ · просрочено', overdue: true })
    const resources = screen.getByTestId('lesson-resources')
    expect(resources).toHaveTextContent('Видео')
    expect(resources).toHaveTextContent('Конспект')
    expect(resources).toHaveTextContent('Задания')
    expect(resources).not.toHaveTextContent('Рабочий лист')
    expect(screen.getByText('Задачи: 2 из 7 выполнено')).toBeInTheDocument()
    expect(screen.getByText(/Срок:.*2020|Срок:.*января/)).toHaveTextContent('МСК')
    expect(screen.getByRole('link')).toHaveAttribute('href', '/lesson/lesson')
    expect(screen.getByText('Перейти к уроку')).toBeInTheDocument()
    expect(screen.getByTestId('lesson-status')).toHaveTextContent('ДЗ просрочено')
  })
  it('принятая работа показывает результат и повторение', () => {
    show({ state: 'done', pill: '✓ пройдено' }, { hw_status: 'accepted', hw_score: 18, hw_max: 20 })
    expect(screen.getByText('Результат: 18 из 20 баллов')).toBeInTheDocument()
    expect(screen.getByText('Повторить урок')).toBeInTheDocument()
    expect(screen.getByTestId('lesson-status')).toHaveTextContent('ДЗ принято')
  })
  it('без ДЗ нет срока или выдуманных материалов', () => {
    show({ state: 'nohw', pill: 'открыт · без ДЗ' }, { hw_id: null, sections: new Set(), tasks_total: 0 })
    expect(screen.queryByTestId('lesson-resources')).toBeNull()
    expect(screen.queryByText(/Срок:/)).toBeNull()
    expect(screen.getByText('Материалы урока')).toBeInTheDocument()
  })
  it('закрытая тема не раскрывает материалы и не даёт перейти', () => {
    show({ state: 'locked', pill: '🔒 закрыт', tip: 'Урок пока закрыт' })
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByTestId('lesson-resources')).toBeNull()
    expect(screen.queryByText(/Срок:/)).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(within(screen.getByTestId('lesson-tile')).getByRole('tooltip')).toHaveTextContent('Урок пока закрыт')
  })
})
