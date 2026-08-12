import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §122. Самоотметка стоит на ГРУППЕ рубрик, а не на каждой вкладке (правка по
 * живому просмотру владельца: отмечать по одной оказалось неудобно).
 *
 * Держим то, на чём легко соврать пользователю: у «Домашнего задания» кнопки
 * нет ни в одном состоянии, у пустой группы кнопки нет вовсе, а подпись
 * говорит «Отметил сам», а не «прочитал».
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

describe('Отметка группы рубрик', () => {
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

  it('у каждой отмечаемой группы одна кнопка, и она в своём ряду', async () => {
    renderPage()

    const theoryRow = await screen.findByTestId('topic-tab-group-theory')
    const lessonRow = screen.getByTestId('topic-tab-group-lesson')

    expect(within(theoryRow).getByTestId('topic-group-mark-theory')).toBeInTheDocument()
    expect(within(lessonRow).getByTestId('topic-group-mark-lesson')).toBeInTheDocument()
    // Порубричной отметки не осталось: два способа отметить одно и то же
    // разъехались бы.
    expect(screen.queryByTestId('topic-section-mark')).not.toBeInTheDocument()
  })

  it('нажатие отмечает всю группу', async () => {
    renderPage()

    fireEvent.click(await screen.findByTestId('topic-group-mark-theory'))

    await waitFor(() => expect(toggle).toHaveBeenCalledWith('theory'))
  })

  it('отмеченная группа подписана «Отметил сам», а не «прочитал»', async () => {
    marksState.marks = new Set(['lesson'])
    renderPage()

    const button = await screen.findByTestId('topic-group-mark-lesson')
    expect(button).toHaveTextContent('Отметил сам')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('topic-group-mark-theory')).toHaveAttribute('aria-pressed', 'false')
  })

  it('группы без единой рубрики нет вовсе — отмечать нечего', async () => {
    materials.length = 1 // остался только конспект → группы «Урок» нет
    renderPage()

    await screen.findByTestId('topic-tab-group-theory')
    expect(screen.queryByTestId('topic-tab-group-lesson')).not.toBeInTheDocument()
    expect(screen.queryByTestId('topic-group-mark-lesson')).not.toBeInTheDocument()

    materials.push({
      kind: 'file', id: 'm2', title: null, position: 1, isVisible: true, section: 'tasks',
      storagePath: `${TOPIC}/c.pdf`, fileName: 'c.pdf', sizeBytes: 1,
    })
  })

  it('группа ДЗ показывает состояние словами и кнопки не имеет', async () => {
    hasHomework.value = true
    homeworkState.state = 'submitted'
    renderPage()

    const row = await screen.findByTestId('topic-tab-group-homework')
    expect(within(row).getByTestId('topic-group-homework-state')).toHaveTextContent('На проверке')
    expect(within(row).queryByTestId('topic-group-mark-homework')).not.toBeInTheDocument()
  })

  it('принятая работа подписана как принятая', async () => {
    hasHomework.value = true
    homeworkState.state = 'accepted'
    renderPage()

    expect(await screen.findByTestId('topic-group-homework-state')).toHaveTextContent('Принято')
  })

  it('закрытое гейтом «Решение ДЗ» кнопки не добавляет — оно в группе ДЗ', async () => {
    solution.hasSolution = true
    solution.unlocked = false
    renderPage()

    const row = await screen.findByTestId('topic-tab-group-homework')
    // Вкладка с замком на месте (§95 не сломан), кнопки отметки в ряду нет.
    expect(within(row).getByRole('tab', { name: /Решение ДЗ/ })).toBeInTheDocument()
    expect(within(row).queryByTestId('topic-group-mark-homework')).not.toBeInTheDocument()
    expect(within(row).getByTestId('topic-group-homework-state')).toBeInTheDocument()
  })

  it('персоналу кнопок нет — за ученика отмечать нельзя', async () => {
    marksState.canMark = false
    renderPage()

    await screen.findByTestId('topic-tab-group-theory')
    expect(screen.queryByTestId('topic-group-mark-theory')).not.toBeInTheDocument()
    expect(screen.queryByTestId('topic-group-mark-lesson')).not.toBeInTheDocument()
  })

  it('отказ базы показывает причину, а не молча возвращает галочку', async () => {
    toggle.mockRejectedValue(new Error('Не удалось сохранить отметку: нет прав'))
    renderPage()

    fireEvent.click(await screen.findByTestId('topic-group-mark-theory'))

    expect(await screen.findByTestId('topic-section-mark-error'))
      .toHaveTextContent('Не удалось сохранить отметку: нет прав')
  })
})
