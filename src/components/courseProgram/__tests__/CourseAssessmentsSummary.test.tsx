/**
 * §241. Раздел «Контрольные, самостоятельные и пробники» у учителя — сводка по
 * классу над программой: блоки по типам, статус, «сдали X из Y», средний и
 * переходы (очередь проверки с фильтром по теме, «Кто пишет», таблица и
 * настройка пробника, окно темы). Шаблон — список без статистики. Без RPC —
 * прежний раздел пробников группы (§224).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const NOW = Date.now()
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString()
const DAY = 24 * 60

let rpcResult: { data: unknown; error: { message: string } | null }
const rpc = vi.fn(() => Promise.resolve(rpcResult))
const fromTables: string[] = []

function chain(value: unknown) {
  const c: Record<string, unknown> = {
    select: () => c, eq: () => c, order: () => c,
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(value).then(res, rej),
  }
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...(a as [])),
    from: (t: string) => { fromTables.push(t); return chain({ data: [{ id: 'old', title: 'Старый пробник', starts_at: null, duration_minutes: 240, photo_grace_minutes: 15, template_id: null }], error: null }) },
  },
}))
vi.mock('@/store/authStore', () => ({ useAuthStore: (sel: any) => sel({ profile: { id: 'p', role: 'teacher' } }) }))

import { CourseAssessmentsSummarySection } from '@/components/courseProgram/CourseAssessmentsSummary'

const SUMMARY = {
  server_now: at(0), is_template: false, group_id: 'g1', group_name: '11А', in_class: 18,
  works: [
    { topic_id: 'k', kind: 'control', title: 'Кинематика', module_title: 'Механика', published: true, opens_at: at(-10), closes_at: at(35), status: 'live', submitted: 3, pending: 3, reviewed: 0, avg_score: null, writing: 14, personal_live: 0 },
    { topic_id: 'tr', kind: 'control', title: 'Тригонометрия', module_title: 'Алгебра', published: true, opens_at: at(-13 * DAY), closes_at: at(-13 * DAY + 45), status: 'review', submitted: 17, pending: 5, reviewed: 12, avg_score: 3.8, writing: 0, personal_live: 0 },
    { topic_id: 'der', kind: 'check', title: 'Производные', module_title: 'Анализ', published: true, opens_at: at(-10 * DAY), closes_at: at(-10 * DAY + 40), status: 'done', submitted: 16, pending: 0, reviewed: 16, avg_score: 4.1, writing: 0, personal_live: 0 },
    { topic_id: 'plan', kind: 'check', title: 'Логарифмы', module_title: 'Алгебра', published: true, opens_at: at(2 * DAY), closes_at: at(2 * DAY + 40), status: 'planned', submitted: 0, pending: 0, reviewed: 0, avg_score: null, writing: 0, personal_live: 0 },
  ],
  mocks: [
    { id: 'p5', title: 'Пробник №5', template_id: 't', starts_at: at(3 * DAY), ends_at: at(3 * DAY + 235), status: 'planned', submitted: 0, pending: 0, avg_score: null, writing: 0, in_group: 18 },
    { id: 'p4', title: 'Пробник №4', template_id: 't', starts_at: at(-6 * DAY), ends_at: at(-6 * DAY + 235), status: 'done', submitted: 14, pending: 0, avg_score: 63, writing: 0, in_group: 18 },
  ],
}

function renderSection(props: Partial<Parameters<typeof CourseAssessmentsSummarySection>[0]> = {}) {
  const onOpenTopic = vi.fn()
  const onShowWorks = vi.fn()
  render(
    <MemoryRouter>
      <CourseAssessmentsSummarySection courseId="c1" isTemplate={false} groupId="g1" groupName="11А" onOpenTopic={onOpenTopic} onShowWorks={onShowWorks} {...props} />
    </MemoryRouter>,
  )
  return { onOpenTopic, onShowWorks }
}

beforeEach(() => {
  rpc.mockClear()
  fromTables.length = 0
  rpcResult = { data: SUMMARY, error: null }
})

describe('CourseAssessmentsSummarySection', () => {
  it('сводка по классу: блоки по типам, «в классе N», строки новые сверху', async () => {
    renderSection()
    const section = await screen.findByTestId('course-assessments')
    expect(rpc).toHaveBeenCalledWith('course_assessments_summary', { p_course_id: 'c1' })
    expect(section).toHaveTextContent('Контрольные, самостоятельные и пробники · 11А')
    expect(screen.getByTestId('course-assessments-note')).toHaveTextContent('в классе 18')
    expect(screen.getAllByTestId('course-assessments-block-head').map(h => h.textContent)).toEqual([
      'Пробники · 2 · средний последнего 63',
      'Контрольные · 2 · ждут проверки 8',
      'Проверочные и самостоятельные · 2',
    ])
    const checks = within(screen.getAllByTestId('course-assessments-block')[2]).getAllByTestId('course-assessments-row')
    expect(checks.map(r => r.textContent)).toEqual([expect.stringContaining('Логарифмы'), expect.stringContaining('Производные')])
  })

  it('строки: статус, сдали, средний; кнопки ведут куда нужно', async () => {
    const { onOpenTopic, onShowWorks } = renderSection()
    await screen.findByTestId('course-assessments')
    const row = (t: string) => screen.getAllByTestId('course-assessments-row').find(r => r.textContent?.includes(t))!
    expect(within(row('Кинематика')).getByTestId('course-assessments-status')).toHaveTextContent('идёт · пишут 14')
    expect(within(row('Кинематика')).getByTestId('course-assessments-submitted')).toHaveTextContent('3 из 18')
    expect(within(row('Тригонометрия')).getByTestId('course-assessments-status')).toHaveTextContent('проверить 5')
    expect(within(row('Тригонометрия')).getByTestId('course-assessments-avg')).toHaveTextContent('3,8')
    expect(within(row('Тригонометрия')).getByRole('link', { name: 'Проверка' })).toHaveAttribute('href', '/homework-queue?topic=tr')
    expect(within(row('Пробник №4')).getByRole('link', { name: 'Таблица' })).toHaveAttribute('href', '/mock-exams/p4?tab=table')
    expect(within(row('Пробник №5')).getByRole('link', { name: 'Настройка' })).toHaveAttribute('href', '/mock-exams/p5?tab=setup')
    fireEvent.click(within(row('Кинематика')).getByRole('button', { name: 'Кто пишет' }))
    expect(onShowWorks).toHaveBeenCalledWith('k')
    fireEvent.click(within(row('Производные')).getByRole('button', { name: 'Работы' }))
    expect(onShowWorks).toHaveBeenCalledWith('der')
    fireEvent.click(within(row('Логарифмы')).getByRole('button', { name: 'Окно темы' }))
    expect(onOpenTopic).toHaveBeenCalledWith('plan')
    expect(screen.getByTestId('course-mock-add')).toHaveAttribute('href', '/mock-exams/new?group=g1')
  })

  it('шаблон курса: только список работ, без статистики и без «Добавить пробник»', async () => {
    rpcResult = { data: { ...SUMMARY, is_template: true, group_id: null, group_name: null, in_class: 0, mocks: [] }, error: null }
    renderSection({ isTemplate: true, groupId: null, groupName: null })
    const section = await screen.findByTestId('course-assessments')
    expect(section).toHaveAttribute('data-template', 'true')
    expect(screen.getByTestId('course-assessments-note')).toHaveTextContent('каркас: окно, сдача и результаты — в классах')
    expect(screen.queryByTestId('course-assessments-status')).toBeNull()
    expect(screen.queryByTestId('course-assessments-submitted')).toBeNull()
    expect(screen.queryByTestId('course-mock-add')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Окно темы' })).toHaveLength(4)
  })

  it('RPC недоступна — прежний раздел пробников группы', async () => {
    rpcResult = { data: null, error: { message: 'function course_assessments_summary does not exist' } }
    renderSection()
    expect(await screen.findByTestId('course-mock-exams')).toBeInTheDocument()
    expect(screen.queryByTestId('course-assessments')).toBeNull()
    await waitFor(() => expect(fromTables).toContain('mock_exams'))
  })

  it('пусто — короткая строка и «Добавить пробник»', async () => {
    rpcResult = { data: { ...SUMMARY, works: [], mocks: [] }, error: null }
    renderSection()
    expect(await screen.findByTestId('course-assessments-empty')).toBeInTheDocument()
    expect(screen.getByTestId('course-mock-add')).toBeInTheDocument()
  })
})
