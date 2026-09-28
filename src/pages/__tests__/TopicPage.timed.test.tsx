import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §240. Тема-контрольная у ученика: метка «Контрольная работа» над названием,
 * по умолчанию открыта сама работа, рубрики подписаны по-своему («Условие»,
 * «Решение», «Ответы и критерии»). Урок — без изменений (TopicPage.tabs).
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'
const kind = { value: 'control' as string | undefined }

const materials: TopicMaterial[] = [
  { kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'worksheet_homework', storagePath: `${TOPIC}/cond.pdf`, fileName: 'cond.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm2', title: null, position: 1, isVisible: true, section: 'solution', storagePath: `${TOPIC}/sol.pdf`, fileName: 'sol.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm3', title: null, position: 2, isVisible: true, section: 'criteria', storagePath: `${TOPIC}/crit.pdf`, fileName: 'crit.pdf', sizeBytes: 1 },
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
        id: TOPIC, title: 'Кинематика: равноускоренное движение', order_index: 0, available_from: null, is_open: true,
        ...(kind.value ? { kind: kind.value } : {}),
        modules: { id: 'mod-1', title: 'Контрольные работы', courses: { id: 'c1', title: 'Физика ЕГЭ 10А', subject: 'physics' } },
      })
      if (table === 'groups') return chain({ id: GROUP, name: '10А' })
      if (table === 'topic_homework') return chain(null, 1)
      return chain(null, 0)
    },
  },
}))
// Один и тот же объект профиля: страница перечитывает тему при смене профиля.
const AUTH = { profile: { id: 'u1', role: 'student' } }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel(AUTH),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/hooks/useTopicSolutionState', () => ({
  useTopicSolutionState: () => ({ hasSolution: true, unlocked: true, loading: false }),
}))
vi.mock('@/components/courseProgram/TopicVariantStudent', () => ({
  TopicVariantStudent: () => null,
  useTopicStudentVariants: () => ({ variants: [] }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkStudent', () => ({ TopicHomeworkStudent: () => <div data-testid="lesson-hw" /> }))
vi.mock('@/components/courseProgram/TopicTimedWorkStudent', () => ({
  TopicTimedWorkStudent: ({ kind: k }: { kind: string }) => <div data-testid="timed-work-stub">{k}</div>,
}))
vi.mock('@/components/courseProgram/TopicTestStudent', () => ({ TopicTestStudent: () => null }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({
  TopicMaterialItems: ({ section }: { section: string }) => <div data-testid={`materials-${section}`} />,
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

describe('Тема-контрольная у ученика (§240)', () => {
  beforeEach(() => { kind.value = 'control' })

  it('метка типа над названием и сразу — экран работы', async () => {
    renderPage()
    expect(await screen.findByTestId('topic-kind-badge')).toHaveTextContent('Контрольная работа')
    expect(screen.getByTestId('timed-work-stub')).toHaveTextContent('control')
    expect(screen.queryByTestId('lesson-hw')).not.toBeInTheDocument()
  })

  it('рубрики подписаны по-своему, видео-заглушки нет', async () => {
    renderPage()
    await screen.findByRole('tablist', { name: 'Разделы темы' })
    const labels = screen.getAllByRole('tab').map(t => t.textContent?.replace(/\d+$/, ''))
    expect(labels).toEqual(['Работа', 'Условие', 'Решение', 'Ответы и критерии'])
    expect(screen.getByTestId('topic-tab-group-homework')).toHaveTextContent('Контрольная работа')
  })

  it('рубрика «Ответы и критерии» открывается как материалы', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /Ответы и критерии/ }))
    expect(await screen.findByTestId('materials-criteria')).toBeInTheDocument()
  })

  it('урок (или база без столбца kind) — прежняя страница', async () => {
    kind.value = undefined
    renderPage()
    await screen.findByRole('tablist', { name: 'Разделы темы' })
    expect(screen.queryByTestId('topic-kind-badge')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Рабочий лист ДЗ/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Видео' })).toHaveAttribute('aria-selected', 'true')
  })
})
