import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §122 → владелец 15.10. Самоотметки «Отметить как сделанное» убраны совсем.
 * Под переключателем остаётся только состояние ДЗ словами — его ставит
 * преподаватель, приняв работу.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'

const materials: TopicMaterial[] = [
  { kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'notes', storagePath: `${TOPIC}/b.pdf`, fileName: 'b.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm2', title: null, position: 1, isVisible: true, section: 'tasks', storagePath: `${TOPIC}/c.pdf`, fileName: 'c.pdf', sizeBytes: 1 },
]

const solution = { hasSolution: false, unlocked: false }
const hasHomework = { value: false }

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
      if (table === 'topic_homework') return chain(null, hasHomework.value ? 1 : 0)
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
vi.mock('@/hooks/useTopicSolutionState', () => ({
  useTopicSolutionState: () => ({ ...solution, loading: false }),
}))
vi.mock('@/components/courseProgram/TopicVariantStudent', () => ({
  TopicVariantStudent: () => null,
  useTopicStudentVariants: () => ({ variants: [] }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkStudent', () => ({ TopicHomeworkStudent: () => null }))
vi.mock('@/components/courseProgram/TopicTestStudent', () => ({ TopicTestStudent: () => null }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({ TopicMaterialItems: () => null }))

const marksState = {
  marks: new Set<string>(),
  canMark: true,
  loading: false,
  error: null as string | null,
}
const toggle = vi.fn()

vi.mock('@/hooks/useTopicSectionMarks', () => ({
  useTopicSectionMarks: () => ({ ...marksState, toggle }),
}))

const homeworkState = { state: 'not_submitted' as string }
vi.mock('@/hooks/useMyTopicHomeworkState', async () => {
  const actual = await vi.importActual<any>('@/hooks/useMyTopicHomeworkState')
  return {
    ...actual,
    useMyTopicHomeworkState: () => ({ state: homeworkState.state, loading: false }),
  }
})

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

describe('Состояние разделов без самоотметки (владелец 15.10)', () => {
  beforeEach(() => {
    marksState.marks = new Set()
    marksState.canMark = true
    marksState.loading = false
    solution.hasSolution = false
    solution.unlocked = false
    hasHomework.value = false
    homeworkState.state = 'not_submitted'
    toggle.mockReset().mockResolvedValue(undefined)
  })

  it('кнопки «Отметить как сделанное» нет ни в одном разделе', async () => {
    hasHomework.value = true
    renderPage()

    await screen.findByTestId('topic-seg-theory')
    for (const seg of ['theory', 'lesson', 'homework']) {
      fireEvent.click(screen.getByTestId(`topic-seg-${seg}`))
      await screen.findByTestId('topic-section-stack')
      expect(screen.queryByRole('button', { name: /Отметить/ })).not.toBeInTheDocument()
      expect(screen.queryByTestId(`topic-group-mark-${seg}`)).not.toBeInTheDocument()
    }
    // У теории ряда состояния нет: там нечего показывать.
    fireEvent.click(screen.getByTestId('topic-seg-theory'))
    expect(screen.queryByTestId('topic-tab-group-theory')).not.toBeInTheDocument()
    expect(toggle).not.toHaveBeenCalled()
  })

  it('раздел ДЗ показывает состояние словами и кнопки не имеет', async () => {
    hasHomework.value = true
    homeworkState.state = 'submitted'
    renderPage()

    fireEvent.click(await screen.findByTestId('topic-seg-homework'))
    const row = await screen.findByTestId('topic-tab-group-homework')
    expect(within(row).getByTestId('topic-group-homework-state')).toHaveTextContent('На проверке')
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })

  it('принятая работа подписана как принятая', async () => {
    hasHomework.value = true
    homeworkState.state = 'accepted'
    renderPage()

    fireEvent.click(await screen.findByTestId('topic-seg-homework'))
    expect(await screen.findByTestId('topic-group-homework-state')).toHaveTextContent('Принято')
  })

  it('закрытое гейтом «Решение ДЗ» — в разделе ДЗ, с заглушкой и состоянием', async () => {
    solution.hasSolution = true
    solution.unlocked = false
    renderPage()

    fireEvent.click(await screen.findByTestId('topic-seg-homework'))
    const section = await screen.findByTestId('topic-section-solution')
    expect(within(section).getByText('Решение пока закрыто')).toBeInTheDocument()
    expect(within(screen.getByTestId('topic-tab-group-homework')).getByTestId('topic-group-homework-state')).toBeInTheDocument()
  })
})
