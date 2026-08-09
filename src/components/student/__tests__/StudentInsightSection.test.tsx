import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { buildStudentInsights } from '@/lib/studentInsights'
import { collapseToWorks, toQueueRows } from '@/lib/homeworkQueue'
import type { StudentInsights } from '@/lib/studentInsights'

const insightsState = { insights: null as StudentInsights | null, loading: false, error: null as string | null }
const feedbackState = {
  saved: [] as any[],
  current: null as any,
  draft: null as any,
  loading: false,
  error: null as string | null,
}
const save = vi.fn()
const generate = vi.fn()

vi.mock('@/hooks/useStudentInsights', () => ({
  useStudentInsights: () => ({ ...insightsState, works: [], reload: vi.fn() }),
}))
vi.mock('@/hooks/useStudentFeedback', () => ({
  useStudentFeedback: () => ({
    ...feedbackState, notes: [], reload: vi.fn(), save, generate,
  }),
}))

import { StudentInsightSection } from '@/components/student/StudentInsightSection'

function rawAttempt(over: Record<string, unknown> = {}, topic = 'Кинематика', hwId = 'hw1') {
  return {
    id: 'a1', homework_id: hwId, student_id: 's1', attempt_number: 1,
    status: 'accepted', submitted_at: '2026-08-01T10:00:00Z',
    created_at: '2026-08-01T09:00:00Z', updated_at: '2026-08-01T10:00:00Z',
    homework: {
      id: hwId, title: 'ДЗ', grade_scale: 'five', due_at: null,
      topic: { id: topic, title: topic, module: { id: 'm1', course: { id: 'c1', title: 'Физика' } } },
    },
    ...over,
  }
}

function insightsWithData(): StudentInsights {
  return buildStudentInsights({
    works: collapseToWorks(toQueueRows([
      rawAttempt({ id: 'a1', attempt_number: 1, status: 'returned_for_revision' }),
      rawAttempt({ id: 'a2', attempt_number: 2, status: 'accepted' }),
      rawAttempt({ id: 'a3', status: 'submitted' }, 'Оптика', 'hw2'),
    ])),
    reviews: [{
      id: 'r1', attempt_id: 'a2', reviewer_id: 'p1', decision: 'accepted',
      comment: null, score: 4, created_at: '2026-08-02T10:00:00Z',
    }],
  })
}

describe('StudentInsightSection — карточка ученика', () => {
  beforeEach(() => {
    insightsState.insights = insightsWithData()
    insightsState.loading = false
    insightsState.error = null
    feedbackState.saved = []
    feedbackState.current = null
    feedbackState.draft = null
    save.mockReset()
    generate.mockReset()
  })

  it('без работ говорит, что считать нечего, а не рисует нули', () => {
    insightsState.insights = buildStudentInsights({ works: [], reviews: [] })
    render(<StudentInsightSection studentId="s1" />)

    expect(screen.getByTestId('student-insights-empty')).toBeInTheDocument()
    // Плитки со средним баллом быть не должно: оценок нет.
    expect(screen.queryByText('Средний балл')).not.toBeInTheDocument()
  })

  it('показывает работы, возвраты и проседающую тему', () => {
    render(<StudentInsightSection studentId="s1" />)

    expect(screen.getByText('Работы')).toBeInTheDocument()
    expect(screen.getByText('Возвращали')).toBeInTheDocument()
    expect(screen.getByTestId('student-weak-topics')).toHaveTextContent('Кинематика')
  })

  it('черновик ИИ не подменяет сохранённый текст сам — только по кнопке', async () => {
    feedbackState.current = { id: 'n1', body: 'мой текст', created_at: '2026-08-08T10:00:00Z', kind: 'saved' }
    generate.mockResolvedValue('черновик модели')
    render(<StudentInsightSection studentId="s1" />)

    const input = screen.getByTestId('student-feedback-input') as HTMLTextAreaElement
    expect(input.value).toBe('мой текст')

    fireEvent.click(screen.getByRole('button', { name: /Собрать черновик/ }))
    await waitFor(() => expect(screen.getByTestId('student-feedback-draft')).toBeInTheDocument())

    // Черновик рядом, поле нетронуто.
    expect(input.value).toBe('мой текст')

    fireEvent.click(screen.getByRole('button', { name: 'Перенести в текст' }))
    expect((screen.getByTestId('student-feedback-input') as HTMLTextAreaElement).value).toBe('черновик модели')
  })

  it('в модель уходят обезличенные цифры, а не ученик', async () => {
    generate.mockResolvedValue('черновик')
    render(<StudentInsightSection studentId="s1" />)

    fireEvent.click(screen.getByRole('button', { name: /Собрать черновик/ }))
    await waitFor(() => expect(generate).toHaveBeenCalled())

    const payload = JSON.stringify(generate.mock.calls[0][0])
    expect(payload).toContain('weak_topics')
    expect(payload).not.toContain('s1')
    expect(payload).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('сохранение отправляет текст и включается только после правки', async () => {
    render(<StudentInsightSection studentId="s1" />)

    const saveButton = screen.getByRole('button', { name: 'Сохранить' })
    expect(saveButton).toBeDisabled()

    fireEvent.change(screen.getByTestId('student-feedback-input'), { target: { value: 'разбор' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith('разбор'))
  })

  it('прошлые версии показывает по запросу, а не разворачивает сразу', () => {
    feedbackState.saved = [
      { id: 'n2', body: 'свежая', created_at: '2026-08-08T10:00:00Z', kind: 'saved' },
      { id: 'n1', body: 'прошлая', created_at: '2026-08-01T10:00:00Z', kind: 'saved' },
    ]
    feedbackState.current = feedbackState.saved[0]
    render(<StudentInsightSection studentId="s1" />)

    expect(screen.queryByTestId('student-feedback-history')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Прошлые версии/ }))
    expect(screen.getByTestId('student-feedback-history')).toHaveTextContent('прошлая')
  })
})
