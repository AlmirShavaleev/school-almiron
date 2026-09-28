import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §239. После «Принято» разбор у ученика ведёт к авторскому решению — это
 * вкладка «Решение ДЗ» той же темы (её открывает база, §95). Страница темы
 * передаёт блоку ДЗ состояние решения и переключение на вкладку.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'

/** Управляемые «нет ДЗ» и «нет решения» — для проверки пустой группы (§121). */
const noHomework = { value: false }
const noSolution = { value: false }
const solutionUnlocked = { value: true }

const materials: TopicMaterial[] = [
  { kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'theory', storagePath: `${TOPIC}/a.pdf`, fileName: 'a.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm2', title: null, position: 1, isVisible: true, section: 'notes', storagePath: `${TOPIC}/b.pdf`, fileName: 'b.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm3', title: null, position: 2, isVisible: true, section: 'tasks', storagePath: `${TOPIC}/c.pdf`, fileName: 'c.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm4', title: null, position: 3, isVisible: true, section: 'task_solution', storagePath: `${TOPIC}/d.pdf`, fileName: 'd.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm5', title: null, position: 4, isVisible: true, section: 'worksheet_tasks', storagePath: `${TOPIC}/e.pdf`, fileName: 'e.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm7', title: null, position: 6, isVisible: true, section: 'solution', storagePath: `${TOPIC}/s.pdf`, fileName: 's.pdf', sizeBytes: 1 },
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

const AUTH = vi.hoisted(() => ({ profile: { id: 'u1', role: 'student' } }))
vi.mock('@/store/authStore', () => ({
  // Один и тот же объект: новый профиль на каждый рендер перезапускал бы
  // загрузку темы при каждом нажатии.
  useAuthStore: (sel: (s: unknown) => unknown) => sel(AUTH),
}))

vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials, loading: false, error: null }),
}))

// Решение есть, но ещё не открыто — вкладка обязана быть, с замком (§95).
vi.mock('@/hooks/useTopicSolutionState', () => ({
  useTopicSolutionState: () => ({ hasSolution: !noSolution.value, unlocked: solutionUnlocked.value, loading: false }),
}))

vi.mock('@/components/courseProgram/TopicVariantStudent', () => ({
  TopicVariantStudent: () => null,
  useTopicStudentVariants: () => ({ variants: [] }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkStudent', () => ({
  TopicHomeworkStudent: (props: { solution?: { unlocked: boolean; hasSolution: boolean } | null; onOpenSolution?: () => void }) => (
    <div data-testid="hw-probe" data-unlocked={String(props.solution?.unlocked)} data-has={String(props.solution?.hasSolution)}>
      <button type="button" onClick={() => props.onOpenSolution?.()}>К решению</button>
    </div>
  ),
}))
vi.mock('@/components/courseProgram/TopicTestStudent', () => ({ TopicTestStudent: () => null }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({
  TopicMaterialItems: ({ section }: { section: string }) => <div data-testid="materials-probe" data-section={section} />,
}))

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

describe('Разбор ДЗ → «Решение ДЗ» (§239)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    noHomework.value = false
    noSolution.value = false
    solutionUnlocked.value = true
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('блок ДЗ знает состояние решения и переключает страницу на его вкладку', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Домашнее задание/ }))
    const probe = await screen.findByTestId('hw-probe')
    expect(probe).toHaveAttribute('data-unlocked', 'true')
    expect(probe).toHaveAttribute('data-has', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'К решению' }))
    expect(screen.getByRole('tab', { name: /Решение ДЗ/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('materials-probe')).toHaveAttribute('data-section', 'solution')
  })

  it('решение закрыто — блок ДЗ получает unlocked=false', async () => {
    solutionUnlocked.value = false
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Домашнее задание/ }))
    expect(await screen.findByTestId('hw-probe')).toHaveAttribute('data-unlocked', 'false')
  })
})
