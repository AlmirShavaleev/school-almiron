import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §240. Тема-контрольная у ученика: метка «Контрольная работа» над названием,
 * по умолчанию открыт раздел работы: сама работа, условие, решение и
 * критерии подряд. Урок — без изменений (TopicPage.tabs).
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const GROUP = 'g0000000-0000-0000-0000-000000000001'
const kind = { value: 'control' as string | undefined }

const materials: TopicMaterial[] = [
  { kind: 'file', id: 'm1', title: null, position: 0, isVisible: true, section: 'worksheet_homework', storagePath: `${TOPIC}/cond.pdf`, fileName: 'cond.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm2', title: null, position: 1, isVisible: true, section: 'solution', storagePath: `${TOPIC}/sol.pdf`, fileName: 'sol.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm3', title: null, position: 2, isVisible: true, section: 'criteria', storagePath: `${TOPIC}/crit.pdf`, fileName: 'crit.pdf', sizeBytes: 1 },
  // §240.1: у работы по времени эти рубрики ученику не показываются.
  { kind: 'file', id: 'm4', title: null, position: 3, isVisible: true, section: 'theory', storagePath: `${TOPIC}/theory.pdf`, fileName: 'theory.pdf', sizeBytes: 1 },
  { kind: 'file', id: 'm5', title: null, position: 4, isVisible: true, section: 'notes', storagePath: `${TOPIC}/notes.pdf`, fileName: 'notes.pdf', sizeBytes: 1 },
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

  it('один раздел работы: работа, условие, решение, критерии; видео, теории и конспекта нет (§240.1)', async () => {
    renderPage()
    await screen.findByTestId('topic-section-stack')
    const segs = [...document.querySelectorAll('[data-testid^="topic-seg-"]')].map(el => el.getAttribute('data-testid'))
    expect(segs).toEqual(['topic-seg-homework', 'topic-seg-review'])
    // Раздел работы в переключателе подписан её типом.
    expect(screen.getByTestId('topic-seg-homework')).toHaveTextContent('Контрольная работа')
    const keys = [...screen.getByTestId('topic-section-stack').querySelectorAll('[data-testid^="topic-section-"]')]
      .map(el => el.getAttribute('data-testid'))
    expect(keys).toEqual(['topic-section-homework', 'topic-section-worksheet_homework', 'topic-section-solution', 'topic-section-criteria'])
    expect(screen.queryByTestId('materials-theory')).not.toBeInTheDocument()
    expect(screen.queryByTestId('materials-notes')).not.toBeInTheDocument()
    expect(screen.queryByTestId('topic-player')).not.toBeInTheDocument()
  })

  it('рубрика «Ответы и критерии» открывается как материалы', async () => {
    renderPage()
    const crit = await screen.findByTestId('topic-section-criteria')
    expect(within(crit).getByTestId('materials-criteria')).toBeInTheDocument()
  })

  it('урок (или база без столбца kind) — прежняя страница', async () => {
    kind.value = undefined
    renderPage()
    await screen.findByRole('tablist', { name: 'Разделы темы' })
    expect(screen.queryByTestId('topic-kind-badge')).not.toBeInTheDocument()
    // Открыт первый раздел, работа — в разделе «ДЗ» с обычной сдачей.
    expect(screen.getByTestId('topic-seg-theory')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('topic-seg-homework'))
    expect(screen.getByTestId('topic-seg-homework')).toHaveTextContent('ДЗ')
    expect(await screen.findByTestId('topic-section-worksheet_homework')).toBeInTheDocument()
    expect(screen.getByTestId('lesson-hw')).toBeInTheDocument()
    expect(screen.queryByTestId('timed-work-stub')).not.toBeInTheDocument()
  })
})
