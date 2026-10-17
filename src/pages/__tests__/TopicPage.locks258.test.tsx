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
  open: { available_from: null as string | null, is_open: true as boolean | null },
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
        id: TOPIC, title: 'Проверочная: производная', order_index: 0, available_from: st.open.available_from, is_open: st.open.is_open, kind: st.kind,
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

/** Рубрика в стеке открытого раздела (владелец 15.10: без подвкладок). */
const section = (key: string) => screen.findByTestId(`topic-section-${key}`)
/** Ключи рубрик открытого раздела в порядке DOM. */
function stackKeys() {
  const stack = screen.getByTestId('topic-section-stack')
  return [...stack.querySelectorAll('[data-testid^="topic-section-"]')]
    .map(el => el.getAttribute('data-testid')!.replace('topic-section-', ''))
}
const SOLUTION_LOCKED = 'Решение пока закрыто'

beforeEach(() => {
  st.kind = 'check'
  st.materials = []
  st.solution = { hasSolution: true, hasHomework: true, unlocked: false, hasCriteria: false, hasCondition: false }
  st.hw = { opens_at: OPENS, closes_at: CLOSES }
  st.serverNow = '2026-10-01T09:00:00.000Z'
  st.open = { available_from: null, is_open: true }
})

describe('«Ответы и критерии» — гейт как у решения (§258)', () => {
  it('ученик до проверки: строк не видно, но сервер говорит «есть» — рубрика с заглушкой', async () => {
    st.materials = [file('cond', 'worksheet_homework')]
    st.solution = { ...st.solution, hasCriteria: true, hasCondition: true }
    renderStudent()
    const crit = await section('criteria')
    expect(within(crit).getByTestId('topic-criteria-locked')).toHaveTextContent('Ответы и критерии пока закрыты')
    expect(within(crit).getByTestId('topic-criteria-locked')).toHaveTextContent('Откроются, когда преподаватель проверит вашу работу')
    expect(screen.queryByTestId('materials-criteria')).not.toBeInTheDocument()
    // Решение — по-прежнему закрыто.
    expect(within(screen.getByTestId('topic-section-solution')).getByText(SOLUTION_LOCKED)).toBeInTheDocument()
  })

  it('ученик после «Принято»: обе рубрики без замка, критерии — материалами', async () => {
    st.materials = ALL
    st.solution = { ...st.solution, unlocked: true, hasCriteria: true, hasCondition: true }
    renderStudent()
    const crit = await section('criteria')
    expect(within(crit).getByTestId('materials-criteria')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-criteria-locked')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('topic-section-solution')).getByTestId('materials-solution')).toBeInTheDocument()
    expect(screen.queryByText(SOLUTION_LOCKED)).not.toBeInTheDocument()
  })

  it('критериев нет — рубрики нет (как раньше)', async () => {
    st.materials = [file('cond', 'worksheet_homework')]
    renderStudent()
    await section('homework')
    expect(screen.queryByTestId('topic-section-criteria')).not.toBeInTheDocument()
  })

  it('урок у ученика: критерии за тем же гейтом (замок до проверки)', async () => {
    st.kind = 'lesson'
    st.materials = [file('theory', 'theory')]
    st.solution = { ...st.solution, hasCriteria: true }
    renderStudent()
    fireEvent.click(await screen.findByTestId('topic-seg-homework'))
    const crit = await section('criteria')
    expect(within(crit).getByTestId('topic-criteria-locked')).toBeInTheDocument()
  })
})

describe('Предпросмотр проверочной «как ученик» (§258)', () => {
  it('до окна: «Условие» — заглушка с датой, файлов нет; критерии и решение закрыты; плашка', async () => {
    st.materials = ALL
    renderPreview()
    await waitFor(() => expect(screen.getByTestId('topic-preview-locks')).toHaveTextContent('с пт 2 окт, 10:00'))
    // «Сейчас» — по серверу (app_server_now), а не по часам машины, где идёт тест.
    const cond = await section('worksheet_homework')
    await waitFor(() => expect(within(cond).getByTestId('topic-condition-locked')).toHaveTextContent('Условие откроется пт, 2 октября в 10:00'))
    expect(screen.queryByTestId('materials-worksheet_homework')).not.toBeInTheDocument()
    expect(screen.getByTestId('topic-preview-locks')).toHaveTextContent(
      'Замки показаны как у ученика: условие — с пт 2 окт, 10:00, решение и критерии — после проверки.',
    )
    // Персоналу строки критериев отдаются все, флага сервера нет — замок всё равно стоит.
    expect(within(screen.getByTestId('topic-section-criteria')).getByTestId('topic-criteria-locked')).toBeInTheDocument()
    expect(screen.queryByTestId('materials-criteria')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('topic-section-solution')).getByText(SOLUTION_LOCKED)).toBeInTheDocument()
  })

  it('после открытия окна: условие — материалами, без замка; критерии — по-прежнему закрыты', async () => {
    st.materials = ALL
    st.serverNow = '2026-10-02T07:10:00.000Z'
    renderPreview()
    const cond = await section('worksheet_homework')
    await waitFor(() => expect(within(cond).getByTestId('materials-worksheet_homework')).toBeInTheDocument())
    expect(screen.queryByTestId('topic-condition-locked')).not.toBeInTheDocument()
    expect(screen.getByTestId('topic-criteria-locked')).toBeInTheDocument()
  })

  it('время не назначено: условие закрыто, заглушка без даты, плашка — «когда будет назначено время»', async () => {
    st.materials = ALL
    st.hw = { opens_at: null, closes_at: null }
    renderPreview()
    expect(await screen.findByTestId('topic-condition-locked')).toHaveTextContent('Время работы ещё не назначено')
    expect(screen.queryByTestId('materials-worksheet_homework')).not.toBeInTheDocument()
    expect(screen.getByTestId('topic-preview-locks')).toHaveTextContent('условие — когда будет назначено время')
  })

  it('обычный урок в предпросмотре — без плашки, «Рабочий лист ДЗ» открыт как раньше', async () => {
    st.kind = 'lesson'
    st.materials = [file('theory', 'theory'), file('ws', 'worksheet_homework')]
    renderPreview()
    fireEvent.click(await screen.findByTestId('topic-seg-homework'))
    const ws = await section('worksheet_homework')
    expect(within(ws).getByTestId('materials-worksheet_homework')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-condition-locked')).not.toBeInTheDocument()
    expect(screen.queryByTestId('topic-preview-locks')).not.toBeInTheDocument()
  })
})

describe('«Условие» у ученика до окна (§258)', () => {
  it('строк нет, сервер говорит «условие есть» — заглушка с датой из окна ученика', async () => {
    st.solution = { ...st.solution, hasCondition: true }
    renderStudent()
    const cond = await section('worksheet_homework')
    await waitFor(() => expect(within(cond).getByTestId('topic-condition-locked')).toHaveTextContent('Условие откроется пт, 2 октября в 10:00'))
    // Плашки предпросмотра у ученика нет.
    expect(screen.queryByTestId('topic-preview-locks')).not.toBeInTheDocument()
  })

  it('окно идёт — строки пришли, условие открыто', async () => {
    st.materials = [file('cond', 'worksheet_homework')]
    st.solution = { ...st.solution, hasCondition: true }
    st.serverNow = '2026-10-02T07:10:00.000Z'
    renderStudent()
    const cond = await section('worksheet_homework')
    expect(within(cond).getByTestId('materials-worksheet_homework')).toBeInTheDocument()
    expect(screen.queryByTestId('topic-condition-locked')).not.toBeInTheDocument()
  })

  it('порядок рубрик работы не изменился: всё в одном разделе работы', async () => {
    st.solution = { ...st.solution, hasCriteria: true, hasCondition: true }
    renderStudent()
    await section('homework')
    const segs = [...document.querySelectorAll('[data-testid^="topic-seg-"]')].map(el => el.getAttribute('data-testid'))
    expect(segs).toEqual(['topic-seg-homework', 'topic-seg-review'])
    expect(screen.getByTestId('topic-seg-homework')).toHaveAttribute('aria-pressed', 'true')
    expect(stackKeys()).toEqual(['homework', 'worksheet_homework', 'solution', 'criteria'])
  })
})

/**
 * Письмо ЛК_СРОЧНО_открытый_урок_с_будущей_датой.md (17.10): урок открыт
 * преподавателем вручную, у него дата в будущем — база пускает (`topic_open_now`:
 * ручное открытие главнее даты), а страница показывала «Тема ещё не открыта».
 */
describe('открытость урока у ученика — как topic_open_now', () => {
  beforeEach(() => { st.kind = 'lesson' })

  it('is_open = true и дата в будущем — открыт, без замка', async () => {
    st.open = { available_from: '2027-02-22', is_open: true }
    renderStudent()
    await screen.findByTestId('topic-section-stack')
    expect(screen.queryByText('Тема ещё не открыта')).toBeNull()
  })

  it('is_open = null и дата в будущем — замок с датой', async () => {
    st.open = { available_from: '2027-02-22', is_open: null }
    renderStudent()
    expect(await screen.findByText('Тема ещё не открыта')).toBeInTheDocument()
    expect(screen.getByText(/Откроется 22 февраля 2027/)).toBeInTheDocument()
  })

  it('is_open = false — закрыт, дата не обещается', async () => {
    st.open = { available_from: '2026-09-01', is_open: false }
    renderStudent()
    expect(await screen.findByText('Тема ещё не открыта')).toBeInTheDocument()
    expect(screen.getByText('Урок пока закрыт')).toBeInTheDocument()
  })
})
