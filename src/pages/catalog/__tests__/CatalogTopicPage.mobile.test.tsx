import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  useCatalogSections: vi.fn(),
  useCatalogTopics: vi.fn(),
  useCatalogPhysicsTopicSections: vi.fn(),
  useCatalogTasks: vi.fn(),
}))

vi.mock('@/hooks/useCatalog', () => ({
  useCatalogSections: (...args: unknown[]) => mocks.useCatalogSections(...args),
  useCatalogTopics: (...args: unknown[]) => mocks.useCatalogTopics(...args),
  useCatalogPhysicsTopicSections: (...args: unknown[]) => mocks.useCatalogPhysicsTopicSections(...args),
  useCatalogTasks: (...args: unknown[]) => mocks.useCatalogTasks(...args),
  SUBJECT_SLUGS: { 'Математика': 'math', 'Физика': 'physics' },
  SUBJECT_FROM_SLUG: { math: 'Математика', physics: 'Физика' },
  EXAM_FROM_SLUG: { ege: 'ЕГЭ', oge: 'ОГЭ' },
  EXAM_SLUGS: { 'ЕГЭ': 'ege', 'ОГЭ': 'oge' },
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector?: (s: { profile: { id: string; role: string } }) => unknown) => {
    const state = { profile: { id: 'student-1', role: 'student' } }
    return selector ? selector(state) : state
  },
}))
vi.mock('@/components/catalog/TaskDisplayCard', () => ({ TaskDisplayCard: () => <div data-testid="task" /> }))
vi.mock('@/components/catalog/CartBadge', () => ({ CartBadge: () => null }))
vi.mock('@/components/catalog/AddToCartButton', () => ({ AddToCartButton: () => null }))
vi.mock('@/components/catalog/PhysicsTopicEditorButton', () => ({ PhysicsTopicEditorButton: () => null }))

import { CatalogTopicPage } from '@/pages/catalog/CatalogTopicPage'

const topics = Array.from({ length: 3 }, (_, i) => ({
  id: `t${i + 1}`, title: `Тема ${i + 1}`, parent_id: null, position: i + 1, slug: null, external_id: i + 1,
  task_count: 7, completed_count: 0, subject: 'Физика', exam_type: 'ЕГЭ', is_published: true,
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/catalog/s1/topic/t1?subject=physics&exam=ege']}>
      <Routes>
        <Route path="/catalog/:sectionId/topic/:topicId" element={<CatalogTopicPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

/**
 * Геометрию jsdom не считает; проверяем структуру, из-за которой страница
 * темы на телефоне была в 18 раз шире экрана (§154, board/008): колонка задач
 * обязана уметь сжиматься (min-w-0), а список тем раздела на узком экране
 * не должен вставать над задачами.
 */
describe('CatalogTopicPage — ширина на телефоне', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // jsdom не умеет scrollIntoView — страница вызывает его для активной темы
    Element.prototype.scrollIntoView = vi.fn()
    mocks.useCatalogSections.mockReturnValue({ sections: [{ id: 's1', title: 'Кинематика', exam_number: 1 }], loading: false, error: null })
    mocks.useCatalogTopics.mockReturnValue({ topics, loading: false, error: null })
    mocks.useCatalogPhysicsTopicSections.mockReturnValue({ sections: [], loading: false, error: null })
    mocks.useCatalogTasks.mockReturnValue({ tasks: [], loading: false, error: null, toggleComplete: vi.fn() })
  })

  it('колонка задач — грид-элемент с min-w-0', () => {
    const { container } = renderPage()
    const section = container.querySelector('section')!
    expect(section).toBeTruthy()
    expect(section.className.split(/\s+/)).toContain('min-w-0')
  })

  it('список тем раздела скрыт до xl и виден с xl', () => {
    const { container } = renderPage()
    const aside = container.querySelector('aside')!
    const classes = aside.className.split(/\s+/)
    expect(classes).toContain('hidden')
    expect(classes).toContain('xl:block')
  })

  it('лента «Быстрый переход» скрыта до xl', () => {
    const { getByTestId } = renderPage()
    const classes = getByTestId('topic-switcher').className.split(/\s+/)
    expect(classes).toContain('hidden')
    expect(classes).toContain('xl:block')
  })

  it('на телефоне есть кнопка «Назад к темам раздела», ведущая на страницу раздела', () => {
    const { getByTestId } = renderPage()
    const back = getByTestId('topic-back-to-section') as HTMLAnchorElement
    expect(back.textContent).toContain('Назад к темам раздела')
    expect(back.getAttribute('href')).toContain('/catalog/s1')
    expect(back.className.split(/\s+/)).toContain('xl:hidden')
  })
})
