import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useStaffModeStore } from '@/store/staffModeStore'

/**
 * §224.2. Страница темы — там владелец и сделал скриншот жалобы 26.09:
 * ученик дошёл до «Урок перед пробником (пустой)», а про идущий пробник «№1»
 * страница не говорила ничего. Теперь сверху баннер с одной кнопкой.
 *
 * Supabase подменён целиком; загрузка пробников — настоящая
 * (`useMyMockExams` → `lib/myMockExams`): ученику — `my_mock_exams`,
 * в предпросмотре персонала — строки `mock_exams` по расписанию.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000070'
const GROUP = 'g0000000-0000-0000-0000-000000000070'
const EXAM = 'e0000000-0000-0000-0000-000000000070'
const MIN = 60_000

let role = 'student'
let myMockExams: unknown = []
const rpcCalls: { name: string; args: unknown }[] = []
const mockExamRows: unknown[] = []

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
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args })
      if (name === 'my_mock_exams') return Promise.resolve({ data: myMockExams, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      if (table === 'students') return chain(role === 'student' ? { id: 'student-1' } : null)
      if (table === 'topics') return chain({
        id: TOPIC, title: 'Урок перед пробником (пустой)', order_index: 1, available_from: null, is_open: true,
        modules: { id: 'mod-1', title: 'Основной', courses: { id: 'c1', title: 'Песочница — пробник (тест)', subject: 'math' } },
      })
      if (table === 'groups') return chain({ id: GROUP, name: 'Песочница' })
      if (table === 'mock_exams') return chain(mockExamRows)
      return chain(null, 0)
    },
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'u1', role } }),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({ useTopicMaterialItems: () => ({ materials: [], loading: false, error: null }) }))
vi.mock('@/hooks/useTopicSolutionState', () => ({ useTopicSolutionState: () => ({ hasSolution: false, unlocked: false, loading: false }) }))
vi.mock('@/components/courseProgram/TopicVariantStudent', () => ({ TopicVariantStudent: () => null, useTopicStudentVariants: () => ({ variants: [] }) }))
vi.mock('@/components/courseProgram/TopicHomeworkStudent', () => ({ TopicHomeworkStudent: () => null }))
vi.mock('@/components/courseProgram/TopicTestStudent', () => ({ TopicTestStudent: () => null }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({ TopicMaterialItems: () => null }))

import { TopicPage } from '@/pages/TopicPage'

function listRow(startOffsetMin: number) {
  const now = Date.now()
  const s = now + startOffsetMin * MIN
  return {
    id: EXAM, title: '№1', module_id: null, module_position: 0,
    starts_at: new Date(s).toISOString(), ends_at: new Date(s + 240 * MIN).toISOString(),
    photos_until: new Date(s + 255 * MIN).toISOString(), duration_minutes: 240,
    submitted_at: null, has_work: false, notified: false, score: null, max_score: null, server_now: new Date(now).toISOString(),
  }
}

function mount() {
  return render(
    <MemoryRouter initialEntries={[`/my-course/${GROUP}/topic/${TOPIC}`]}>
      <Routes>
        <Route path="/my-course/:groupId/topic/:topicId" element={<TopicPage />} />
        <Route path="/my-course/:groupId/mock/:examId" element={<p>страница пробника</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  role = 'student'
  myMockExams = []
  rpcCalls.length = 0
  mockExamRows.length = 0
  localStorage.clear()
  useStaffModeStore.setState({ mode: 'admin', profileId: 'u1', choiceMade: true })
})

describe('TopicPage — идущий пробник группы (§224.2)', () => {
  it('ученик: баннер «Идёт пробник «№1» · осталось 7 мин» над темой, кнопка ведёт на пробник', async () => {
    myMockExams = [listRow(-233)]
    mount()
    const banner = await screen.findByTestId('mock-alert')
    expect(banner).toHaveTextContent('Идёт пробник «№1»')
    expect(banner).toHaveTextContent('осталось 7 мин')
    const title = screen.getByRole('heading', { level: 1, name: 'Урок перед пробником (пустой)' })
    expect(banner.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(rpcCalls).toContainEqual({ name: 'my_mock_exams', args: { p_group_id: GROUP } })
    fireEvent.click(screen.getByRole('link', { name: /Начать/ }))
    expect(await screen.findByText('страница пробника')).toBeInTheDocument()
  })

  it('ближайший сегодня — тихая строка с отсчётом', async () => {
    myMockExams = [listRow(150)]
    mount()
    const line = await screen.findByTestId('mock-alert')
    expect(line).toHaveAttribute('data-kind', 'soon')
    expect(line).toHaveTextContent('через 2 ч 30 мин')
  })

  it('пробников нет или RPC ещё не на проде — тема без баннера и без ошибки', async () => {
    myMockExams = null
    mount()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByTestId('mock-alert')).toBeNull()
  })

  it('предпросмотр «Ученик» у владельца: пробник по расписанию из mock_exams, my_mock_exams не зовётся', async () => {
    role = 'owner'
    useStaffModeStore.setState({ mode: 'student', profileId: 'u1', choiceMade: true })
    mockExamRows.push({ id: EXAM, title: '№1', group_id: GROUP, starts_at: new Date(Date.now() - 233 * MIN).toISOString(), duration_minutes: 240, photo_grace_minutes: 15 })
    mount()
    const banner = await screen.findByTestId('mock-alert')
    expect(banner).toHaveTextContent('Идёт пробник «№1»')
    expect(rpcCalls.map(c => c.name)).not.toContain('my_mock_exams')
  })
})
