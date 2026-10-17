/**
 * Страница темы на catalog_topic_page: счётчики и фильтры — с сервера, прежний
 * useCatalogTasks не грузит ничего, «Показать ещё» — следующая порция.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  useCatalogTasks: vi.fn(),
  useCatalogTopicPage: vi.fn(),
  loadMore: vi.fn(),
}))

vi.mock('@/hooks/useCatalogTopicPage', () => ({
  useCatalogTopicPage: (...a: unknown[]) => mocks.useCatalogTopicPage(...a),
}))
vi.mock('@/hooks/useCatalog', () => ({
  useCatalogSections: () => ({ sections: [{ id: 'sec-1', title: 'Кинематика', subject: 'Физика', exam_type: 'ЕГЭ', external_id: 1, exam_number: 1, position: 1 }], loading: false, error: null }),
  useCatalogTopics: () => ({ topics: [{ id: 'topic-1', title: 'Равноускоренное движение', external_id: 1, parent_id: null, slug: null, position: 1 }], loading: false, error: null }),
  useCatalogPhysicsTopicSections: () => ({ sections: [], loading: false, error: null }),
  useCatalogTasks: (...a: unknown[]) => mocks.useCatalogTasks(...a),
  SUBJECT_SLUGS: { 'Математика': 'math', 'Физика': 'physics' },
}))
vi.mock('@/lib/catalogLock', async (orig) => ({
  ...(await orig<typeof import('@/lib/catalogLock')>()),
  useSectionLocked: () => false,
}))
vi.mock('@/hooks/useCatalogPractice', () => ({
  useCatalogPractice: () => ({ state: null, check: vi.fn(), reveal: vi.fn() }),
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel?: (s: { profile: { id: string; role: string } }) => unknown) => {
    const s = { profile: { id: 'student-1', role: 'student' } }
    return sel ? sel(s) : s
  },
}))
vi.mock('@/components/catalog/TaskDisplayCard', () => ({
  TaskDisplayCard: ({ task, number }: { task: { id: string }; number: number }) => <div data-testid="task">{number}:{task.id}</div>,
}))
vi.mock('@/components/catalog/CartBadge', () => ({ CartBadge: () => null }))
vi.mock('@/components/catalog/AddToCartButton', () => ({ AddToCartButton: () => null }))
vi.mock('@/components/catalog/PhysicsTopicEditorButton', () => ({ PhysicsTopicEditorButton: () => null }))
vi.mock('@/components/catalog/CatalogNumberProgress', () => ({ CatalogNumberProgress: () => null }))

import { CatalogTopicPage } from '@/pages/catalog/CatalogTopicPage'

const tasks = Array.from({ length: 20 }, (_, i) => ({ id: `t${i + 1}`, is_completed: i < 3 }))

function renderPage(url = '/catalog/sec-1/topic/topic-1?subject=physics&exam=ege') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/catalog/:sectionId/topic/:topicId" element={<CatalogTopicPage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.useCatalogTasks.mockReset().mockReturnValue({ tasks: [], loading: true, error: null, toggleComplete: vi.fn() })
  mocks.loadMore.mockReset()
  mocks.useCatalogTopicPage.mockReset().mockReturnValue({
    missing: false, tasks, stats: { total: 45, done: 7, filtered: 45, byDifficulty: {} }, locked: false,
    loading: false, error: null, hasMore: true, loadingMore: false, loadMore: mocks.loadMore, toggleComplete: vi.fn(),
  })
})

describe('страница темы на серверных порциях', () => {
  it('счётчик темы — с сервера (не по загруженной порции), прежний путь ничего не грузит', () => {
    renderPage()
    expect(screen.getByText('Выполнено 7 из 45')).toBeInTheDocument()
    expect(screen.getAllByTestId('task')).toHaveLength(20)
    expect(screen.getAllByTestId('task')[19].textContent).toBe('20:t20')
    expect(mocks.useCatalogTasks).toHaveBeenCalledWith(undefined, expect.any(Number), 'exam')
  })

  it('«Показать ещё» — следующая порция; подпись — из серверного числа', () => {
    renderPage()
    const btn = screen.getByRole('button', { name: /Показать ещё 20 задач/ })
    expect(btn.textContent).toContain('(20 из 45)')
    fireEvent.click(btn)
    expect(mocks.loadMore).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('topic-load-more-sentinel')).toBeInTheDocument()
  })

  it('фильтры и вид уходят в запрос', () => {
    renderPage('/catalog/sec-1/topic/topic-1?subject=physics&exam=ege&view=physics-topics&filter=todo')
    expect(mocks.useCatalogTopicPage).toHaveBeenLastCalledWith(expect.objectContaining({ topicId: 'topic-1', view: 'physics-topics', filter: 'todo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Сложная' }))
    const last = mocks.useCatalogTopicPage.mock.calls.at(-1)![0] as { difficulties: Set<string> }
    expect([...last.difficulties]).toEqual(['сложная'])
  })

  it('§292: сервер ответил «закрыто» (и во вкладке «Физические темы») — плашка, не пустой список', () => {
    mocks.useCatalogTopicPage.mockReturnValue({
      missing: false, tasks: [], stats: { total: 0, done: 0, filtered: 0, byDifficulty: {} }, locked: true,
      loading: false, error: null, hasMore: false, loadingMore: false, loadMore: vi.fn(), toggleComplete: vi.fn(),
    })
    renderPage('/catalog/sec-1/topic/topic-1?subject=physics&exam=ege&view=physics-topics')
    expect(screen.getByText(/откроется/)).toBeInTheDocument()
    expect(screen.queryByText('Задачи не найдены.')).toBeNull()
  })

  it('без миграции — прежний путь', () => {
    mocks.useCatalogTopicPage.mockReturnValue({
      missing: true, tasks: [], stats: null, locked: false, loading: false, error: null,
      hasMore: false, loadingMore: false, loadMore: vi.fn(), toggleComplete: vi.fn(),
    })
    mocks.useCatalogTasks.mockReturnValue({ tasks: [{ id: 'old1', is_completed: true }, { id: 'old2' }], loading: false, error: null, toggleComplete: vi.fn() })
    renderPage()
    expect(mocks.useCatalogTasks).toHaveBeenCalledWith('topic-1', expect.any(Number), 'exam')
    expect(screen.getByText('Выполнено 1 из 2')).toBeInTheDocument()
    expect(screen.getAllByTestId('task')).toHaveLength(2)
  })
})
