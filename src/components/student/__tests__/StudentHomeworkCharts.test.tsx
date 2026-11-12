import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StudentHomeworkCharts } from '../StudentHomeworkCharts'
import type { QueueRow } from '@/lib/homeworkQueue'
import type { TopicHomeworkReviewRow } from '@/lib/topicHomework'
describe('графики ученика', () => {
  it('фильтрует предмет и открывает работу по точке', () => {
    const at = new Date().toISOString()
    const works = ['physics','math'].map((subject, i) => ({ subject, attempt: { id: String(i), status: 'accepted', submitted_at: at }, homeworkTitle: subject, gradeScale: 'hundred', topicKind: 'lesson' })) as QueueRow[]
    const reviews = works.map((w, i) => ({ attempt_id: w.attempt.id, decision: 'accepted', score: 50 + i * 10, created_at: at })) as TopicHomeworkReviewRow[]
    render(<StudentHomeworkCharts works={works} reviews={reviews} />)
    const point = screen.getByRole('link', { name: /physics: 50 из 100/ })
    expect(point).toHaveAttribute('href', '/homework-queue?attempt=0')
    fireEvent.change(screen.getByLabelText('Предмет'), { target: { value: 'math' } })
    expect(screen.queryByRole('link', { name: /physics: 50/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Пока одна оценка/)).toBeInTheDocument()
  })
  it('пустые данные не становятся нулевой оценкой', () => {
    render(<StudentHomeworkCharts works={[]} reviews={[]} />)
    expect(screen.getByText(/нет принятых ДЗ с оценками/)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
