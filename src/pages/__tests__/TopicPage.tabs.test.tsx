import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

/** Ключи разделов переключателя в порядке DOM. */
function segKeys() {
  return [...document.querySelectorAll('[data-testid^="topic-seg-"]')]
    .map(el => el.getAttribute('data-testid')!.replace('topic-seg-', ''))
}

/** Ключи рубрик открытого раздела в порядке DOM. */
function stackKeys() {
  const stack = screen.getByTestId('topic-section-stack')
  return [...stack.querySelectorAll('[data-testid^="topic-section-"]')]
    .map(el => el.getAttribute('data-testid')!.replace('topic-section-', ''))
}

/** Состав открытого раздела; ждёт, пока страница дочитает данные. */
async function expectStack(keys: string[]) {
  await waitFor(() => expect(stackKeys()).toEqual(keys))
}

describe('Разделы темы (владелец 15.10; было §116, §121)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMaterials()
    noHomework.value = false
    noSolution.value = false
  })

  it('разделы — крупные кнопки, подвкладок нет', async () => {
    renderPage()

    await screen.findByRole('tablist', { name: 'Разделы темы' })
    expect(segKeys()).toEqual(['theory', 'lesson', 'homework', 'review'])
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(screen.getByTestId('topic-seg-theory')).toHaveAttribute('aria-pressed', 'true')
  })

  it('все рубрики раздела отрисованы подряд, каждая в своём разделе', async () => {
    renderPage()

    await expectStack(['notes', 'theory'])

    fireEvent.click(screen.getByTestId('topic-seg-lesson'))
    await expectStack(['tasks', 'task_solution', 'worksheet_tasks'])
    expect(screen.getByTestId('topic-seg-lesson')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('topic-seg-theory')).toHaveAttribute('aria-pressed', 'false')

    // В ДЗ задание идёт первым, решение последним.
    fireEvent.click(screen.getByTestId('topic-seg-homework'))
    await expectStack(['homework', 'worksheet_homework', 'solution'])
  })

  it('закрытое гейтом решение — заглушка с замком на месте рубрики (§95)', async () => {
    renderPage()

    fireEvent.click(await screen.findByTestId('topic-seg-homework'))
    const solution = await screen.findByTestId('topic-section-solution')
    expect(within(solution).getByText('Решение пока закрыто')).toBeInTheDocument()
    expect(solution.querySelector('svg.lucide-lock')).not.toBeNull()
  })
})

/**
 * §121, пункт 4: у темы без ДЗ не должно быть ни раздела «ДЗ», ни пустого
 * места под ним.
 */
describe('Пустой раздел не рисуется (§121)', () => {
  it('нет ДЗ и решения — нет и раздела «ДЗ»', async () => {
    resetMaterials([
      { kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'notes', storagePath: `${TOPIC}/b.pdf`, fileName: 'b.pdf', sizeBytes: 1 },
      { kind: 'file', id: 'm2', title: null, position: 1, isVisible: true, section: 'tasks', storagePath: `${TOPIC}/c.pdf`, fileName: 'c.pdf', sizeBytes: 1 },
    ])
    noHomework.value = true
    noSolution.value = true

    renderPage()

    await screen.findByTestId('topic-seg-theory')
    expect(segKeys()).toEqual(['theory', 'lesson', 'review'])
    expect(screen.queryByTestId('topic-seg-homework')).not.toBeInTheDocument()
    expect(screen.queryByText('ДЗ')).not.toBeInTheDocument()
  })
})
