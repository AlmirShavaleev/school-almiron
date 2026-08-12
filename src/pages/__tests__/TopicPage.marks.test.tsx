import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §122. Самоотметки по разделам темы.
 *
 * Держим три вещи, на которых легко соврать пользователю: ДЗ отметить нельзя
 * (его засчитывает преподаватель), закрытую гейтом рубрику отметить нельзя, а
 * подпись говорит «отметил сам», а не «прочитал».
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'

const materials: TopicMaterial[] = [
  { kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'notes', storagePath: `${TOPIC}/b.pdf`, fileName: 'b.pdf', sizeBytes: 1 },
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

describe('Отметка раздела темы', () => {
  beforeEach(() => {
    marksState.marks = new Set()
    marksState.canMark = true
    marksState.loading = false
    solution.hasSolution = false
    solution.unlocked = false
    hasHomework.value = false
    toggle.mockReset().mockResolvedValue(undefined)
  })

  it('кнопка отмечает раздел и говорит, что отметка своя', async () => {
    renderPage()

    const button = await screen.findByTestId('topic-section-mark')
    expect(button).toHaveTextContent('Отметить как сделанное')
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    await waitFor(() => expect(toggle).toHaveBeenCalledWith('video'))
  })

  it('отмеченный раздел подписан «Отметил сам», а не «прочитал»', async () => {
    marksState.marks = new Set(['video'])
    renderPage()

    const button = await screen.findByTestId('topic-section-mark')
    expect(button).toHaveTextContent('Отметил сам')
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('ДЗ отметить нельзя — вместо кнопки объяснение', async () => {
    hasHomework.value = true
    renderPage()

    // Вкладка ДЗ появляется после отдельного запроса — ждём именно её.
    fireEvent.click(await screen.findByRole('tab', { name: /Домашнее задание/ }))

    expect(await screen.findByTestId('topic-section-homework-note'))
      .toHaveTextContent(/засчитывается сам — когда преподаватель примет работу/i)
    expect(screen.queryByTestId('topic-section-mark')).not.toBeInTheDocument()
  })

  it('закрытую гейтом рубрику решения отметить нельзя', async () => {
    solution.hasSolution = true
    solution.unlocked = false
    renderPage()

    fireEvent.click(await screen.findByRole('tab', { name: /Решение ДЗ/ }))

    expect(screen.queryByTestId('topic-section-mark')).not.toBeInTheDocument()
  })

  it('открытую рубрику решения отметить можно', async () => {
    solution.hasSolution = true
    solution.unlocked = true
    renderPage()

    fireEvent.click(await screen.findByRole('tab', { name: /Решение ДЗ/ }))

    expect(await screen.findByTestId('topic-section-mark')).toBeInTheDocument()
  })

  it('персоналу кнопки нет — за ученика отмечать нельзя', async () => {
    marksState.canMark = false
    renderPage()

    await screen.findByRole('tablist', { name: 'Разделы темы' })
    expect(screen.queryByTestId('topic-section-mark')).not.toBeInTheDocument()
  })

  it('отказ базы показывает причину, а не молча возвращает галочку', async () => {
    toggle.mockRejectedValue(new Error('Не удалось сохранить отметку: нет прав'))
    renderPage()

    fireEvent.click(await screen.findByTestId('topic-section-mark'))

    expect(await screen.findByTestId('topic-section-mark-error'))
      .toHaveTextContent('Не удалось сохранить отметку: нет прав')
  })
})
