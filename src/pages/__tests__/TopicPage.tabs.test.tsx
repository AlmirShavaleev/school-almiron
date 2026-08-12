import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §116. Вкладки рубрик уезжали за край с горизонтальной прокруткой даже там,
 * где ширины хватало: активную приходилось искать пальцем. Теперь они
 * переносятся — сетка на узком экране, перенос строки на широком.
 *
 * Тест держит то, что должно пережить перекраску: лента со скроллом больше не
 * лента, все рубрики отрисованы разом (а не «есть где-то правее»), замок §95
 * на месте.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'

/** Управляемые «нет ДЗ» и «нет решения» — для проверки пустой группы (§121). */
const noHomework = { value: false }
const noSolution = { value: false }

const materials: TopicMaterial[] = [
  { kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'theory', storagePath: `${TOPIC}/a.pdf`, fileName: 'a.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm2', title: null, position: 1, isVisible: true, section: 'notes', storagePath: `${TOPIC}/b.pdf`, fileName: 'b.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm3', title: null, position: 2, isVisible: true, section: 'tasks', storagePath: `${TOPIC}/c.pdf`, fileName: 'c.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm4', title: null, position: 3, isVisible: true, section: 'task_solution', storagePath: `${TOPIC}/d.pdf`, fileName: 'd.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm5', title: null, position: 4, isVisible: true, section: 'worksheet_tasks', storagePath: `${TOPIC}/e.pdf`, fileName: 'e.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm6', title: null, position: 5, isVisible: true, section: 'worksheet_homework', storagePath: `${TOPIC}/f.pdf`, fileName: 'f.pdf', sizeBytes: 1 },
]

function chain(result: unknown, count = 0) {
  const c: any = {}
  for (const m of ['select', 'eq', 'order', 'in', 'limit']) c[m] = () => c
  c.single = () => Promise.resolve({ data: result, error: null })
  c.maybeSingle = () => Promise.resolve({ data: result, error: null })
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result, error: null, count }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'students') return chain({ id: 'student-1' })
      if (table === 'topics') return chain({
        id: TOPIC, title: 'Кинематика', order_index: 0, available_from: null,
        modules: { id: 'mod-1', title: 'Механика', courses: { id: 'c1', title: 'Физика', subject: 'physics' } },
      })
      if (table === 'groups') return chain({ id: GROUP, name: '11А' })
      if (table === 'topic_homework') return chain(null, noHomework.value ? 0 : 1)
      if (table === 'topic_test_assignments') return chain(null, 0)
      return chain(null, 0)
    },
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'u1', role: 'student' } }),
}))

vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials, loading: false, error: null }),
}))

// Решение есть, но ещё не открыто — вкладка обязана быть, с замком (§95).
vi.mock('@/hooks/useTopicSolutionState', () => ({
  useTopicSolutionState: () => ({ hasSolution: !noSolution.value, unlocked: false, loading: false }),
}))

vi.mock('@/components/courseProgram/TopicVariantStudent', () => ({
  TopicVariantStudent: () => null,
  useTopicStudentVariants: () => ({ variants: [] }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkStudent', () => ({ TopicHomeworkStudent: () => null }))
vi.mock('@/components/courseProgram/TopicTestStudent', () => ({ TopicTestStudent: () => null }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({ TopicMaterialItems: () => null }))

import { TopicPage } from '@/pages/TopicPage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/my-course/${GROUP}/topic/${TOPIC}`]}>
      <Routes>
        <Route path="/my-course/:groupId/topic/:topicId" element={<TopicPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const FULL_MATERIALS: TopicMaterial[] = [...materials]

function resetMaterials(list: TopicMaterial[] = FULL_MATERIALS) {
  materials.length = 0
  materials.push(...list)
}

describe('Вкладки рубрик темы (§116)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMaterials()
    noHomework.value = false
    noSolution.value = false
  })

  it('лента больше не скроллится: вкладки переносятся', async () => {
    renderPage()

    const tablist = await screen.findByRole('tablist', { name: 'Разделы темы' })
    expect(tablist.className).not.toContain('overflow-x-auto')
    // Перенос живёт внутри ряда группы: сетка на узком, flex-wrap на широком.
    const row = screen.getByTestId('topic-tab-group-theory')
    expect(row.querySelector('.grid, .sm\:flex-wrap')).not.toBeNull()
  })

  it('все рубрики отрисованы разом, а не «где-то правее»', async () => {
    renderPage()

    await screen.findByRole('tablist', { name: 'Разделы темы' })
    const tabs = screen.getAllByRole('tab')

    // Видео + шесть рубрик с материалами + решение (гейт) + ДЗ = 9.
    expect(tabs.length).toBe(9)
    for (const label of ['Теория', 'Конспект', 'Задачи', 'Решение задач', 'Рабочий лист задач', 'Рабочий лист ДЗ']) {
      expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })

  it('активная вкладка есть всегда и она одна', async () => {
    renderPage()

    await screen.findByRole('tablist', { name: 'Разделы темы' })
    const selected = screen.getAllByRole('tab').filter(t => t.getAttribute('aria-selected') === 'true')

    expect(selected).toHaveLength(1)
  })

  it('закрытая гейтом рубрика решения осталась с замком', async () => {
    renderPage()

    const tab = await screen.findByRole('tab', { name: /Решение ДЗ/ })
    expect(tab.querySelector('svg.lucide-lock')).not.toBeNull()
  })

  /**
   * §121. Вкладки шли сплошной лентой и читались как куча. Теперь три
   * смысловые группы; составы живут в общем перечне рубрик, и тест сторожит
   * именно то, что видно на экране.
   */
  it('вкладки разложены по группам «Теория», «Урок», «Домашнее задание»', async () => {
    renderPage()

    await screen.findByRole('tablist', { name: 'Разделы темы' })

    expect(screen.getByTestId('topic-tab-group-theory')).toBeInTheDocument()
    expect(screen.getByTestId('topic-tab-group-lesson')).toBeInTheDocument()
    expect(screen.getByTestId('topic-tab-group-homework')).toBeInTheDocument()
  })

  it('в группе ДЗ задание идёт первым, решение последним', async () => {
    renderPage()

    const group = await screen.findByTestId('topic-tab-group-homework')
    const labels = within(group).getAllByRole('tab').map(t => t.textContent?.trim())

    expect(labels?.[0]).toContain('Домашнее задание')
    expect(labels?.at(-1)).toContain('Решение ДЗ')
  })

  it('каждая вкладка стоит в своей группе, а не где придётся', async () => {
    renderPage()

    const lesson = await screen.findByTestId('topic-tab-group-lesson')
    expect(within(lesson).getByRole('tab', { name: /Задачи/ })).toBeInTheDocument()
    expect(within(lesson).queryByRole('tab', { name: /Конспект/ })).not.toBeInTheDocument()

    const theory = screen.getByTestId('topic-tab-group-theory')
    expect(within(theory).getByRole('tab', { name: /Конспект/ })).toBeInTheDocument()
  })

  it('замок §95 остаётся видимым в своей группе', async () => {
    renderPage()

    const group = await screen.findByTestId('topic-tab-group-homework')
    const tab = within(group).getByRole('tab', { name: /Решение ДЗ/ })

    expect(tab.querySelector('svg.lucide-lock')).not.toBeNull()
  })
})

/**
 * §121, пункт 4: у темы без ДЗ не должно быть ни подписи «Домашнее задание»,
 * ни пустого места под ней.
 */
describe('Пустая группа вкладок не рисуется (§121)', () => {
  it('нет ДЗ и решения — нет и группы «Домашнее задание»', async () => {
    resetMaterials([
      { kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'notes', storagePath: `${TOPIC}/b.pdf`, fileName: 'b.pdf', sizeBytes: 1 },
      { kind: 'file', id: 'm2', title: null, position: 1, isVisible: true, section: 'tasks', storagePath: `${TOPIC}/c.pdf`, fileName: 'c.pdf', sizeBytes: 1 },
    ])
    noHomework.value = true
    noSolution.value = true

    renderPage()

    await screen.findByTestId('topic-tab-group-theory')
    expect(screen.getByTestId('topic-tab-group-lesson')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-tab-group-homework')).not.toBeInTheDocument()
    expect(screen.queryByText('Домашнее задание')).not.toBeInTheDocument()
  })
})
