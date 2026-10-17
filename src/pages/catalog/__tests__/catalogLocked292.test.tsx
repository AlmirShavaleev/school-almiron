import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/**
 * §292. Закрытый по подписке предмет, открытый по прямой ссылке: страницы
 * раздела, темы и задачи показывают плашку «Этот предмет откроется с
 * подпиской» (и «К каталогу») вместо пустого списка, красной ошибки или
 * «Задача не найдена». Открытый предмет — как раньше.
 */
const mocks = vi.hoisted(() => ({
  useCatalogSections: vi.fn(),
  useCatalogTopics: vi.fn(),
  useCatalogPhysicsTopicSections: vi.fn(),
  useCatalogSearch: vi.fn(),
  useCatalogTasks: vi.fn(),
  useCatalogTask: vi.fn(),
  locked: { section: false as boolean | null, task: false as boolean | null },
}))

vi.mock('@/hooks/useCatalog', async (orig) => ({
  ...(await orig<object>()),
  useCatalogSections: (...a: unknown[]) => mocks.useCatalogSections(...a),
  useCatalogTopics: (...a: unknown[]) => mocks.useCatalogTopics(...a),
  useCatalogPhysicsTopicSections: (...a: unknown[]) => mocks.useCatalogPhysicsTopicSections(...a),
  useCatalogSearch: (...a: unknown[]) => mocks.useCatalogSearch(...a),
  useCatalogTasks: (...a: unknown[]) => mocks.useCatalogTasks(...a),
  useCatalogTask: (...a: unknown[]) => mocks.useCatalogTask(...a),
}))
vi.mock('@/lib/catalogLock', async (orig) => ({
  ...(await orig<object>()),
  useSectionLocked: () => mocks.locked.section,
  useTaskLocked: () => mocks.locked.task,
}))
vi.mock('@/hooks/useCatalogPractice', () => ({
  useCatalogPractice: () => ({ state: null, loading: false, error: null, check: vi.fn(), reveal: vi.fn() }),
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector?: (s: { profile: { id: string; role: string } }) => unknown) => {
    const state = { profile: { id: 'student-1', role: 'student' } }
    return selector ? selector(state) : state
  },
}))

// Флаг подписки (выкатка в main, 16.10): тексты замков зависят от него; по умолчанию включён.
const subsFlag = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/hooks/useSubscription', () => ({ useSubscriptionsEnabled: () => ({ enabled: subsFlag.enabled, loading: false }) }))

import { CatalogSectionPage } from '@/pages/catalog/CatalogSectionPage'
import { CatalogTopicPage } from '@/pages/catalog/CatalogTopicPage'
import { CatalogTaskPage } from '@/pages/catalog/CatalogTaskPage'

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/catalog/:sectionId" element={<CatalogSectionPage />} />
        <Route path="/catalog/:sectionId/topic/:topicId" element={<CatalogTopicPage />} />
        <Route path="/catalog/task/:taskId" element={<CatalogTaskPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.locked.section = false
  mocks.locked.task = false
  mocks.useCatalogSections.mockReturnValue({ sections: [], loading: false, error: null })
  mocks.useCatalogTopics.mockReturnValue({ topics: [], loading: false, error: null })
  mocks.useCatalogPhysicsTopicSections.mockReturnValue({ sections: [], loading: false, error: null })
  mocks.useCatalogSearch.mockReturnValue({ results: [], loading: false, error: null })
  mocks.useCatalogTasks.mockReturnValue({ tasks: [], loading: false, error: null, toggleComplete: vi.fn(), completedIds: new Set() })
  mocks.useCatalogTask.mockReturnValue({ task: null, loading: false, error: null })
})

describe('§292: закрытый предмет по прямой ссылке', () => {
  it('раздел: плашка вместо пустого списка; даже если функция ответила CATALOG_LOCKED — без красной ошибки', async () => {
    mocks.locked.section = true
    mocks.useCatalogTopics.mockReturnValue({ topics: [], loading: false, error: 'Банк задач откроется с подпиской или пробным периодом' })
    renderAt('/catalog/sec-math?subject=math&exam=ege')
    expect(await screen.findByTestId('catalog-locked')).toHaveTextContent('Этот предмет откроется с подпиской')
    expect(screen.getByTestId('catalog-locked-back')).toHaveAttribute('href', '/catalog')
    expect(screen.queryByRole('button', { name: /Повторить/ })).toBeNull()
  })

  it('подписка выключена (не тестировщик) — про курс, ни слова о подписке; замок тот же', async () => {
    subsFlag.enabled = false
    mocks.locked.section = true
    renderAt('/catalog/sec-math?subject=math&exam=ege')
    const notice = await screen.findByTestId('catalog-locked')
    expect(notice).toHaveTextContent('Этот предмет откроется вместе с курсом')
    expect(notice.textContent).not.toMatch(/подписк|пробн/)
    expect(screen.queryByTestId('catalog-locked-subscribe')).toBeNull()
    subsFlag.enabled = true
  })

  it('тема: плашка', async () => {
    mocks.locked.section = true
    renderAt('/catalog/sec-math/topic/t1?subject=math&exam=ege')
    expect(await screen.findByTestId('catalog-locked')).toBeInTheDocument()
  })

  it('задача: плашка, а не «Задача не найдена»', async () => {
    mocks.locked.task = true
    renderAt('/catalog/task/task-1')
    expect(await screen.findByTestId('catalog-locked')).toBeInTheDocument()
    expect(screen.queryByText('Задача не найдена')).toBeNull()
  })

  it('открытый предмет — без плашки, как раньше', async () => {
    renderAt('/catalog/sec-phys?subject=physics&exam=ege')
    await screen.findAllByText(/Каталог/)
    expect(screen.queryByTestId('catalog-locked')).toBeNull()
    renderAt('/catalog/task/task-2')
    expect(await screen.findByText('Задача не найдена')).toBeInTheDocument()
  })
})
