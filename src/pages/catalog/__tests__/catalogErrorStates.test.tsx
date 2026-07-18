import { describe, expect, it, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  useCatalogDirectionCounts: vi.fn(),
  useCatalogSections: vi.fn(),
  useCatalogTopics: vi.fn(),
  useCatalogPhysicsTopicSections: vi.fn(),
  useCatalogSearch: vi.fn(),
  useCatalogTasks: vi.fn(),
}))

vi.mock('@/hooks/useCatalog', () => ({
  useCatalogDirectionCounts: (...args: unknown[]) => mocks.useCatalogDirectionCounts(...args),
  useCatalogSections: (...args: unknown[]) => mocks.useCatalogSections(...args),
  useCatalogTopics: (...args: unknown[]) => mocks.useCatalogTopics(...args),
  useCatalogPhysicsTopicSections: (...args: unknown[]) => mocks.useCatalogPhysicsTopicSections(...args),
  useCatalogSearch: (...args: unknown[]) => mocks.useCatalogSearch(...args),
  useCatalogTasks: (...args: unknown[]) => mocks.useCatalogTasks(...args),
  SUBJECT_SLUGS: { 'Математика': 'math', 'Физика': 'physics' },
  SUBJECT_FROM_SLUG: { math: 'Математика', physics: 'Физика' },
  EXAM_FROM_SLUG: { ege: 'ЕГЭ', oge: 'ОГЭ' },
  EXAM_SLUGS: { 'ЕГЭ': 'ege', 'ОГЭ': 'oge' },
  DIRECTIONS: [
    { key: 'math-ege', subject: 'Математика', examType: 'ЕГЭ', subjectSlug: 'math', examSlug: 'ege', label: 'Математика ЕГЭ', desc: 'desc' },
  ],
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector?: (s: { profile: { id: string; role: string } }) => unknown) => {
    const state = { profile: { id: 'student-1', role: 'student' } }
    return selector ? selector(state) : state
  },
}))

import { CatalogPage } from '@/pages/catalog/CatalogPage'
import { CatalogSectionPage } from '@/pages/catalog/CatalogSectionPage'
import { CatalogTopicPage } from '@/pages/catalog/CatalogTopicPage'

describe('Catalog error states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useCatalogDirectionCounts.mockReturnValue({ counts: {}, error: null })
    mocks.useCatalogSections.mockReturnValue({ sections: [], loading: false, error: null })
    mocks.useCatalogTopics.mockReturnValue({ topics: [], loading: false, error: null })
    mocks.useCatalogPhysicsTopicSections.mockReturnValue({ sections: [], loading: false, error: null })
    mocks.useCatalogSearch.mockReturnValue({ results: [], loading: false, error: null })
    mocks.useCatalogTasks.mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      toggleComplete: vi.fn(),
      completedIds: new Set(),
    })
  })

  it('shows a retryable error state on catalog landing when direction counts fail', () => {
    mocks.useCatalogDirectionCounts.mockReturnValue({
      counts: {},
      error: 'rpc rejected',
    })

    render(
      <MemoryRouter initialEntries={['/catalog']}>
        <Routes>
          <Route path="/catalog" element={<CatalogPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Не удалось загрузить каталог')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
    expect(screen.getByText('rpc rejected')).toBeInTheDocument()
  })

  it('shows a retryable error state on section page when topics fail', () => {
    mocks.useCatalogSections.mockReturnValue({
      sections: [{ id: 'sec-1', title: 'Раздел 1', subject: 'Математика', exam_type: 'ЕГЭ', external_id: 1, exam_number: 1, position: 1 }],
      loading: false,
      error: null,
    })
    mocks.useCatalogTopics.mockReturnValue({
      topics: [],
      loading: false,
      error: 'topics failed',
    })

    render(
      <MemoryRouter initialEntries={['/catalog/sec-1?subject=math&exam=ege']}>
        <Routes>
          <Route path="/catalog/:sectionId" element={<CatalogSectionPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Не удалось загрузить каталог')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
    expect(screen.getByText('topics failed')).toBeInTheDocument()
    expect(mocks.useCatalogSections).toHaveBeenCalledWith('Математика', 'ЕГЭ', expect.any(Number))
  })

  it('shows a retryable error state on topic page when tasks fail', () => {
    mocks.useCatalogSections.mockReturnValue({
      sections: [{ id: 'sec-1', title: 'Раздел 1', subject: 'Математика', exam_type: 'ЕГЭ', external_id: 1, exam_number: 1, position: 1 }],
      loading: false,
      error: null,
    })
    mocks.useCatalogTopics.mockReturnValue({
      topics: [{ id: 'topic-1', title: 'Тема 1', external_id: 1, parent_id: null, slug: null, position: 1 }],
      loading: false,
      error: null,
    })
    mocks.useCatalogTasks.mockReturnValue({
      tasks: [],
      loading: false,
      error: 'tasks failed',
      toggleComplete: vi.fn(),
      completedIds: new Set(),
    })

    render(
      <MemoryRouter initialEntries={['/catalog/sec-1/topic/topic-1?subject=math&exam=ege']}>
        <Routes>
          <Route path="/catalog/:sectionId/topic/:topicId" element={<CatalogTopicPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Не удалось загрузить каталог')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
    expect(screen.getByText('tasks failed')).toBeInTheDocument()
    expect(mocks.useCatalogSections).toHaveBeenCalledWith('Математика', 'ЕГЭ', expect.any(Number))
  })

  it('passes physics-topics view into hooks and preserves it in breadcrumbs', () => {
    mocks.useCatalogSections.mockReturnValue({
      sections: [{ id: 'sec-1', title: 'Механика', subject: 'Физика', exam_type: 'ЕГЭ', external_id: 1, exam_number: 1, position: 1 }],
      loading: false,
      error: null,
    })
    mocks.useCatalogTopics.mockReturnValue({
      topics: [{ id: 'topic-1', title: 'Кинематика', external_id: 1, parent_id: null, slug: null, position: 1 }],
      loading: false,
      error: null,
    })
    mocks.useCatalogTasks.mockReturnValue({
      tasks: [],
      loading: false,
      error: null,
      toggleComplete: vi.fn(),
      completedIds: new Set(),
    })

    render(
      <MemoryRouter initialEntries={['/catalog/sec-1/topic/topic-1?subject=physics&exam=ege&view=physics-topics']}>
        <Routes>
          <Route path="/catalog/:sectionId/topic/:topicId" element={<CatalogTopicPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(mocks.useCatalogTasks).toHaveBeenCalledWith('topic-1', expect.any(Number), 'physics-topics')
    expect(mocks.useCatalogSections).toHaveBeenCalledWith('Физика', 'ЕГЭ', expect.any(Number))
    expect(mocks.useCatalogTopics).toHaveBeenCalledWith('sec-1', expect.any(Number), 'physics-topics', 'Физика', 'ЕГЭ')

    const catalogLink = screen.getByRole('link', { name: 'Каталог' })
    const sectionLink = screen.getByRole('link', { name: 'Механика' })
    expect(catalogLink.getAttribute('href')).toContain('view=physics-topics')
    expect(sectionLink.getAttribute('href')).toContain('view=physics-topics')
  })

  it('shows a human error state for section search failures', () => {
    mocks.useCatalogSections.mockReturnValue({
      sections: [{ id: 'sec-1', title: 'Раздел 1', subject: 'Математика', exam_type: 'ЕГЭ', external_id: 1, exam_number: 1, position: 1 }],
      loading: false,
      error: null,
    })
    mocks.useCatalogTopics.mockReturnValue({
      topics: [{ id: 'topic-1', title: 'Тема 1', external_id: 1, parent_id: null, slug: null, position: 1, task_count: 1, completed_count: 0 }],
      loading: false,
      error: null,
    })
    mocks.useCatalogSearch.mockReturnValue({
      results: [],
      loading: false,
      error: 'search failed',
    })

    render(
      <MemoryRouter initialEntries={['/catalog/sec-1?subject=math&exam=ege']}>
        <Routes>
          <Route path="/catalog/:sectionId" element={<CatalogSectionPage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByTestId('catalog-search-input'), { target: { value: '12' } })

    expect(screen.getByText('Не удалось загрузить каталог')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
    expect(screen.getByText('search failed')).toBeInTheDocument()
  })
})
