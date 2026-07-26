import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HomeworkCatalogTaskPicker } from '@/components/modals/HomeworkCatalogTaskPicker'
import type { CatalogTask, CatalogTopic } from '@/hooks/useCatalog'

const hookMocks = vi.hoisted(() => ({
  useCatalogSections: vi.fn(),
  useCatalogTopics: vi.fn(),
  useCatalogTasks: vi.fn(),
  useCatalogSearch: vi.fn(),
}))

vi.mock('@/hooks/useCatalog', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useCatalog')>('@/hooks/useCatalog')
  return {
    ...actual,
    useCatalogSections: (...args: unknown[]) => hookMocks.useCatalogSections(...args),
    useCatalogTopics: (...args: unknown[]) => hookMocks.useCatalogTopics(...args),
    useCatalogTasks: (...args: unknown[]) => hookMocks.useCatalogTasks(...args),
    useCatalogSearch: (...args: unknown[]) => hookMocks.useCatalogSearch(...args),
  }
})

vi.mock('@/components/catalog/TaskDisplayCard', () => ({
  TaskDisplayCard: ({ task, extraActions }: { task: CatalogTask; extraActions?: React.ReactNode }) => (
    <div>
      <span>task-{task.external_id}</span>
      {extraActions}
    </div>
  ),
}))

describe('HomeworkCatalogTaskPicker', () => {
  beforeEach(() => {
    hookMocks.useCatalogSections.mockImplementation(() => ({
      sections: [{ id: 'sec-1', title: 'Раздел 1', task_count: 2 }],
      loading: false,
      error: null,
    }))
    hookMocks.useCatalogTopics.mockImplementation((sectionId?: string) => ({
      topics: sectionId === 'sec-1'
        ? [{ id: 'topic-1', title: 'Тема 1', external_id: 1, parent_id: null, slug: null, position: 1 } satisfies CatalogTopic]
        : [],
      loading: false,
      error: null,
    }))
    hookMocks.useCatalogTasks.mockImplementation((topicId?: string) => ({
      tasks: topicId === 'topic-1'
        ? [{
            id: 'task-1',
            external_id: 101,
            section_id: 'sec-1',
            subject: 'Математика',
            exam_type: 'ЕГЭ',
            statement_html: '<p>Task</p>',
            answer_html: null,
            solution_html: null,
            solution_plan_html: null,
            grade_criteria_html: null,
            has_answer: false,
            has_solution: false,
            position: 1,
          } satisfies CatalogTask]
        : [],
      loading: false,
      error: null,
    }))
    hookMocks.useCatalogSearch.mockImplementation(() => ({
      results: [],
      loading: false,
      error: null,
    }))
  })

  it('показывает темы после выбора раздела и загружает задачи после выбора темы', () => {
    const onAdd = vi.fn()
    const onTopicChange = vi.fn()

    render(
      <HomeworkCatalogTaskPicker
        onAdd={onAdd}
        isSelected={() => false}
        onTopicChange={onTopicChange}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('— выберите раздел —'), { target: { value: 'sec-1' } })
    expect(screen.getByRole('option', { name: 'Тема 1' })).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('— выберите тему —'), { target: { value: 'topic-1' } })
    expect(onTopicChange).toHaveBeenCalledWith({ id: 'topic-1', title: 'Тема 1' })
    expect(screen.getByText('task-101')).toBeInTheDocument()
  })

  it('в режиме "Поиск / номер" показывает те же карточки и позволяет добавить найденную задачу', () => {
    const onAdd = vi.fn()

    hookMocks.useCatalogSearch.mockImplementation((query: string, sectionId?: string, enabled?: boolean) => ({
      results: enabled && sectionId === 'sec-1' && query === '101'
        ? [{
            id: 'task-search-1',
            external_id: 101,
            section_id: 'sec-1',
            subject: 'Математика',
            exam_type: 'ЕГЭ',
            statement_html: '<p>Search Task</p>',
            answer_html: '<p>42</p>',
            solution_html: '<p>Solution</p>',
            solution_plan_html: null,
            grade_criteria_html: null,
            has_answer: true,
            has_solution: true,
            position: 1,
            assets: [],
          } satisfies CatalogTask]
        : [],
      loading: false,
      error: null,
    }))

    render(
      <HomeworkCatalogTaskPicker
        onAdd={onAdd}
        isSelected={() => false}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('— выберите раздел —'), { target: { value: 'sec-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Поиск / номер' }))
    fireEvent.change(screen.getByPlaceholderText('например: 12'), { target: { value: '101' } })

    expect(screen.getByText('task-101')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Добавить/i }))
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-search-1', external_id: 101 }))
  })
})
