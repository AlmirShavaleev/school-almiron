import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §263. Страница своей идущей работы: ставит отметку «открыл условие» и
 * считает уходы со страницы — только пока база говорит, что идёт ИМЕННО эта
 * работа (my_work_mode); сдал / окно кончилось / чужая работа / предпросмотр —
 * ни отметки, ни счёта. Ученику показывается только предупреждение (в самой
 * работе, TopicTimedWorkStudent), без счётчика.
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
const activity = vi.hoisted(() => ({ marks: [] as unknown[][], away: [] as unknown[] }))
vi.mock('@/hooks/useWorkActivity', () => ({
  useWorkOpenMark: (...args: unknown[]) => { activity.marks.push(args) },
  useAwayTracker: (opts: unknown) => { activity.away.push(opts) },
}))
vi.mock('@/hooks/useTimedWork', () => ({
  useTopicTimedWindow: () => ({ loaded: true, homeworkId: 'hw1', opensAt: '2026-10-03T05:45:00.000Z', closesAt: '2026-10-03T06:30:00.000Z', opened: true }),
}))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({
  TopicMaterialItems: ({ section }: { section: string }) => <div data-testid={`materials-${section}`} />,
}))

import { TopicPage } from '@/pages/TopicPage'
import { useWorkModeStore } from '@/store/workModeStore'
import { parseWorkMode } from '@/lib/workMode'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/my-course/${GROUP}/topic/${TOPIC}`]}>
      <Routes>
        <Route path="/my-course/:groupId/topic/:topicId" element={<TopicPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const work = (homeworkId: string) => parseWorkMode({
  active: true, kind: 'timed', work_kind: 'control', homework_id: homeworkId, topic_id: TOPIC, group_id: GROUP,
  title: 'Кинематика', closes_at: '2026-10-03T06:30:00.000Z', server_now: '2026-10-03T06:00:00.000Z',
})

const last = <T,>(a: T[]) => a[a.length - 1]

describe('Страница своей работы во время окна (§263)', () => {
  beforeEach(() => {
    kind.value = 'control'
    activity.marks = []
    activity.away = []
  })

  it('идёт эта работа — отметка «открыл условие» и счёт уходов включены', async () => {
    useWorkModeStore.setState({ work: work('hw1'), offsetMs: 0, loaded: true })
    renderPage()
    expect(await screen.findByTestId('topic-kind-badge')).toBeInTheDocument()
    expect(last(activity.marks)).toEqual(['hw1', true])
    expect(last(activity.away)).toEqual({ homeworkId: 'hw1', active: true })
  })

  it('работы нет (сдал или окно кончилось) — ни отметки, ни счёта', async () => {
    useWorkModeStore.setState({ work: null, offsetMs: 0, loaded: true })
    renderPage()
    expect(await screen.findByTestId('topic-kind-badge')).toBeInTheDocument()
    expect(last(activity.marks)).toEqual(['hw1', false])
    expect(last(activity.away)).toEqual({ homeworkId: 'hw1', active: false })
  })

  it('идёт другая работа (эта тема — не она) — здесь не считаем', async () => {
    useWorkModeStore.setState({ work: work('hw-other'), offsetMs: 0, loaded: true })
    renderPage()
    expect(await screen.findByTestId('topic-kind-badge')).toBeInTheDocument()
    expect(activity.marks.every(m => m[1] === false)).toBe(true)
    expect(activity.away.every(a => (a as { active: boolean }).active === false)).toBe(true)
  })
})
