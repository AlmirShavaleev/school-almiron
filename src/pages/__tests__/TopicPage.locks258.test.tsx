import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { StudentViewScope } from '@/store/staffModeStore'
import type { TopicMaterial } from '@/lib/topicMaterialItems'

/**
 * §258. Честные замки на странице темы — у ученика и в предпросмотре «как
 * ученик». Владелец увидел в предпросмотре проверочной «Ответы и критерии»
 * без замка и решил, что критерии открыты ученикам. Теперь:
 *  · «Ответы и критерии» — тот же гейт, что «Решение» (замок, заглушка);
 *  · у ученика вкладка есть и тогда, когда строк не видно (флаг сервера);
 *  · «Условие» работы по времени в предпросмотре до окна — заглушка с датой
 *    открытия, а не файлы; после открытия окна — материалы;
 *  · урок — без изменений.
 * Supabase подменён целиком: окно и «сейчас» отдаёт RPC, как сервер.
 */

const TOPIC = 'f0000000-0000-0000-0000-000000000258'
const GROUP = 'g0000000-0000-0000-0000-000000000258'
// Окно: пт 2 октября 10:00–10:45 по Москве.
const OPENS = '2026-10-02T07:00:00.000Z'
const CLOSES = '2026-10-02T07:45:00.000Z'

const st = {
  kind: 'check' as string,
  role: 'student' as 'student' | 'teacher',
  materials: [] as TopicMaterial[],
  solution: { hasSolution: true, hasHomework: true, unlocked: false, hasCriteria: false, hasCondition: false },
  hw: { opens_at: OPENS as string | null, closes_at: CLOSES as string | null },
  serverNow: '2026-10-01T09:00:00.000Z',
}

const file = (id: string, section: string): TopicMaterial => ({
  kind: 'file', id, title: null, position: 0, isVisible: true, section: section as TopicMaterial['section'],
  storagePath: `${TOPIC}/${id}.pdf`, fileName: `${id}.pdf`, sizeBytes: 1,
})
const ALL = [file('cond', 'worksheet_homework'), file('sol', 'solution'), file('crit', 'criteria')]

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
    rpc: (name: string) => {
      // Окна ученика у персонала нет — RPC отвечает null, время берётся из app_server_now.
      if (name === 'topic_homework_my_window') {
        return Promise.resolve({
          data: st.role === 'student' ? { timed: true, opens_at: st.hw.opens_at, closes_at: st.hw.closes_at, personal: false, server_now: st.serverNow } : null,
          error: null,
        })
      }
      if (name === 'app_server_now') return Promise.resolve({ data: st.serverNow, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      if (table === 'students') return chain({ id: 'student-1' })
      if (table === 'topics') return chain({
        id: TOPIC, title: 'Проверочная: производная', order_index: 0, available_from: null, is_open: true, kind: st.kind,
        modules: { id: 'mod-1', title: 'Производная', courses: { id: 'c1', title: 'Математика ЕГЭ', subject: 'math' } },
      })
      if (table === 'groups') return chain({ id: GROUP, name: '11А' })
      if (table === 'topic_homework') return chain({ id: 'hw-1', topic_id: TOPIC, is_published: true, ...st.hw }, 1)
      return chain(null, 0)
    },
  },
}))
const AUTH = { student: { profile: { id: 'u1', role: 'student' } }, teacher: { profile: { id: 't1', role: 'teacher' } } }
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel(AUTH[st.role]),
}))
vi.mock('@/hooks/useTopicMaterialItems', () => ({
  useTopicMaterialItems: () => ({ materials: st.materials, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('@/hooks/useTopicSolutionState', () => ({
  useTopicSolutionState: () => ({ ...st.solution, loading: false }),
}))
vi.mock('@/components/courseProgram/TopicVariantStudent', () => ({
  TopicVariantStudent: () => null,
  useTopicStudentVariants: () => ({ variants: [] }),
}))
vi.mock('@/components/courseProgram/TopicHomeworkStudent', () => ({ TopicHomeworkStudent: () => <div data-testid="lesson-hw" /> }))
vi.mock('@/components/courseProgram/TopicTimedWorkStudent', () => ({ TopicTimedWorkStudent: () => <div data-testid="timed-work-stub" /> }))
vi.mock('@/components/courseProgram/TopicTestStudent', () => ({ TopicTestStudent: () => null }))
vi.mock('@/components/courseProgram/TopicMaterialItems', () => ({
  TopicMaterialItems: ({ section }: { section: string }) => <div data-testid={`materials-${section}`} />,
}))

import { TopicPage } from '@/pages/TopicPage'

function renderStudent() {
  st.role = 'student'
  return render(
    <MemoryRouter initialEntries={[`/my-course/${GROUP}/topic/${TOPIC}`]}>
      <Routes>
        <Route path="/my-course/:groupId/topic/:topicId" element={<TopicPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function renderPreview() {
  st.role = 'teacher'
  return render(
    <MemoryRouter>
      <StudentViewScope>
        <TopicPage groupId={GROUP} topicId={TOPIC} staffBar={<div data-testid="staff-bar" />} />
      </StudentViewScope>
    </MemoryRouter>,
  )
}

const tab = (name: RegExp) => screen.findByRole('tab', { name })
/** Замок вкладки — svg lucide-lock внутри кнопки. */
const locked = (el: HTMLElement) => !!el.querySelector('svg.lucide-lock')

beforeEach(() => {
  st.kind = 'check'
  st.materials = []
  st.solution = { hasSolution: true, hasHomework: true, unlocked: false, hasCriteria: false, hasCondition: false }
  st.hw = { opens_at: OPENS, closes_at: CLOSES }
  st.serverNow = '2026-10-01T09:00:00.000Z'
})

describe('«Ответы и критерии» — гейт как у решения (§258)', () => {
  it('ученик до проверки: строк не видно, но сервер говорит «есть» — вкладка с замком и заглушкой', async () => {
    st.materials = [file('cond', 'worksheet_homework')]
    st.solution = { ...st.solution, hasCriteria: true, hasCondition: true }
    renderStudent()
    const crit = await tab(/Ответы и критерии/)
    expect(locked(crit)).toBe(true)
    fireEvent.click(crit)
    expect(screen.getByTestId('topic-criteria-locked')).toHaveTextContent('Ответы и критерии пока закрыты')
    expect(screen.getByTestId('topic-criteria-locked')).toHaveTextContent('Откроются, когда преподаватель проверит вашу работу')
    expect(screen.queryByTestId('materials-criteria')).not.toBeInTheDocument()
    // Решение — по-прежнему с замком.
    expect(locked(screen.getByRole('tab', { name: /Решение/ }))).toBe(true)
  })

  it('ученик после «Принято»: обе вкладки без замка, критерии — материалами', async () => {
    st.materials = ALL
    st.solution = { ...st.solution, unlocked: true, hasCriteria: true, hasCondition: true }
    renderStudent()
    const crit = await tab(/Ответы и критерии/)
    expect(locked(crit)).toBe(false)
    expect(locked(screen.getByRole('tab', { name: /Решение/ }))).toBe(false)
    fireEvent.click(crit)
    expect(screen.getByTestId('materials-criteria')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-criteria-locked')).not.toBeInTheDocument()
  })

  it('критериев нет — вкладки нет (как раньше)', async () => {
    st.materials = [file('cond', 'worksheet_homework')]
    renderStudent()
    await tab(/Работа/)
    expect(screen.queryByRole('tab', { name: /Ответы и критерии/ })).not.toBeInTheDocument()
  })

  it('урок у ученика: критерии за тем же гейтом (замок до проверки)', async () => {
    st.kind = 'lesson'
    st.materials = [file('theory', 'theory')]
    st.solution = { ...st.solution, hasCriteria: true }
    renderStudent()
    const crit = await tab(/Ответы и критерии/)
    expect(locked(crit)).toBe(true)
  })
})

describe('Предпросмотр проверочной «как ученик» (§258)', () => {
  it('до окна: «Условие» с замком и заглушкой с датой, файлов нет; критерии и решение с замком; плашка', async () => {
    st.materials = ALL
    renderPreview()
    const cond = await tab(/Условие/)
    await waitFor(() => expect(screen.getByTestId('topic-preview-locks')).toHaveTextContent('с пт 2 окт, 10:00'))
    // «Сейчас» — по серверу (app_server_now), а не по часам машины, где идёт тест.
    await waitFor(() => expect(locked(cond)).toBe(true))
    // Персоналу строки критериев отдаются все, флага сервера нет — замок всё равно стоит.
    expect(locked(screen.getByRole('tab', { name: /Ответы и критерии/ }))).toBe(true)
    expect(locked(screen.getByRole('tab', { name: /Решение/ }))).toBe(true)
    expect(screen.getByTestId('topic-preview-locks')).toHaveTextContent(
      'Замки показаны как у ученика: условие — с пт 2 окт, 10:00, решение и критерии — после проверки.',
    )

    fireEvent.click(cond)
    expect(screen.getByTestId('topic-condition-locked')).toHaveTextContent('Условие откроется пт, 2 октября в 10:00')
    expect(screen.queryByTestId('materials-worksheet_homework')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Ответы и критерии/ }))
    expect(screen.getByTestId('topic-criteria-locked')).toBeInTheDocument()
    expect(screen.queryByTestId('materials-criteria')).not.toBeInTheDocument()
  })

  it('после открытия окна: условие — материалами, без замка; критерии — по-прежнему закрыты', async () => {
    st.materials = ALL
    st.serverNow = '2026-10-02T07:10:00.000Z'
    renderPreview()
    const cond = await tab(/Условие/)
    await waitFor(() => expect(locked(cond)).toBe(false))
    fireEvent.click(cond)
    expect(screen.getByTestId('materials-worksheet_homework')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-condition-locked')).not.toBeInTheDocument()
    expect(locked(screen.getByRole('tab', { name: /Ответы и критерии/ }))).toBe(true)
  })

  it('время не назначено: условие закрыто, заглушка без даты, плашка — «когда будет назначено время»', async () => {
    st.materials = ALL
    st.hw = { opens_at: null, closes_at: null }
    renderPreview()
    fireEvent.click(await tab(/Условие/))
    expect(await screen.findByTestId('topic-condition-locked')).toHaveTextContent('Время работы ещё не назначено')
    expect(screen.queryByTestId('materials-worksheet_homework')).not.toBeInTheDocument()
    expect(screen.getByTestId('topic-preview-locks')).toHaveTextContent('условие — когда будет назначено время')
  })

  it('обычный урок в предпросмотре — без плашки, «Рабочий лист ДЗ» открыт как раньше', async () => {
    st.kind = 'lesson'
    st.materials = [file('theory', 'theory'), file('ws', 'worksheet_homework')]
    renderPreview()
    const ws = await tab(/Рабочий лист ДЗ/)
    expect(locked(ws)).toBe(false)
    fireEvent.click(ws)
    expect(screen.getByTestId('materials-worksheet_homework')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-preview-locks')).not.toBeInTheDocument()
  })
})

describe('«Условие» у ученика до окна (§258)', () => {
  it('строк нет, сервер говорит «условие есть» — вкладка с замком и датой из окна ученика', async () => {
    st.solution = { ...st.solution, hasCondition: true }
    renderStudent()
    const cond = await tab(/Условие/)
    expect(locked(cond)).toBe(true)
    fireEvent.click(cond)
    await waitFor(() => expect(screen.getByTestId('topic-condition-locked')).toHaveTextContent('Условие откроется пт, 2 октября в 10:00'))
    // Плашки предпросмотра у ученика нет.
    expect(screen.queryByTestId('topic-preview-locks')).not.toBeInTheDocument()
  })

  it('окно идёт — строки пришли, вкладка открыта', async () => {
    st.materials = [file('cond', 'worksheet_homework')]
    st.solution = { ...st.solution, hasCondition: true }
    st.serverNow = '2026-10-02T07:10:00.000Z'
    renderStudent()
    const cond = await tab(/Условие/)
    expect(locked(cond)).toBe(false)
    fireEvent.click(cond)
    expect(screen.getByTestId('materials-worksheet_homework')).toBeInTheDocument()
  })

  it('порядок вкладок работы не изменился', async () => {
    st.solution = { ...st.solution, hasCriteria: true, hasCondition: true }
    renderStudent()
    const list = await screen.findByRole('tablist', { name: 'Разделы темы' })
    const labels = within(list).getAllByRole('tab').map(t => t.textContent?.replace(/\d+$/, ''))
    expect(labels).toEqual(['Работа', 'Условие', 'Решение', 'Ответы и критерии'])
  })
})
