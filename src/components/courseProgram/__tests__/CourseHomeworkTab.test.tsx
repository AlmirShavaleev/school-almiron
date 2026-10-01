import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * §250. Вкладка «Домашние задания»: журнал «ученики × разделы» — основной вид,
 * раздел раскрывается в ДЗ своих тем; клетки (✓, оценка, ждёт, дораб.,
 * просроч., —); «X из Y» у раздела; «Сначала отстающие»; нажатие на клетку —
 * переход к работе ученика; прежний список — «По темам», и `focusTopicId`
 * открывает именно его.
 */

const rpcSpy = vi.fn()
let rpcResult: { data: unknown; error: { message: string } | null } = { data: null, error: null }

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => { rpcSpy(fn, args); return Promise.resolve(rpcResult) } },
}))
vi.mock('@/components/courseProgram/CourseTopicHomeworkSection', () => ({
  CourseTopicHomeworkSection: ({ focusTopicId }: { focusTopicId?: string | null }) => (
    <div data-testid="by-topics" data-focus={focusTopicId ?? ''}>Список по темам</div>
  ),
}))

import { CourseHomeworkTab } from '@/components/courseProgram/CourseHomeworkTab'

const TODAY = '2026-10-01'
const JOURNAL = {
  server_now: '2026-10-01T09:00:00Z', today: TODAY, is_template: false, group_id: 'g1', group_name: '11А',
  students: [{ student_id: 's1', name: 'Абрамова Софья' }, { student_id: 's2', name: 'Белов Кирилл' }],
  homeworks: [
    { topic_id: 't1', homework_id: 'h1', module_id: 'm1', module_title: '№2 Векторы', module_order: 1, topic_title: 'Сложение векторов', topic_order: 1, due_at: '2026-09-20', grade_scale: null, topic_open: true },
    { topic_id: 't2', homework_id: 'h2', module_id: 'm1', module_title: '№2 Векторы', module_order: 1, topic_title: 'Координаты', topic_order: 2, due_at: '2026-10-10', grade_scale: 'five', topic_open: true },
    { topic_id: 't3', homework_id: 'h3', module_id: 'm2', module_title: '№3 Стереометрия', module_order: 2, topic_title: 'Призма', topic_order: 1, due_at: null, grade_scale: null, topic_open: true },
  ],
  cells: [
    { topic_id: 't1', student_id: 's1', status: 'reviewed', score: null, attempt_id: 'a11', attempt_number: 1 },
    { topic_id: 't2', student_id: 's1', status: 'reviewed', score: 5, attempt_id: 'a12', attempt_number: 1 },
    { topic_id: 't3', student_id: 's1', status: 'returned', score: null, attempt_id: 'a13', attempt_number: 1 },
    // Белов: t1 — нет попытки при прошедшем сроке; t2 — сдал, ждёт; t3 — ничего (срока нет).
    { topic_id: 't2', student_id: 's2', status: 'submitted', score: null, attempt_id: 'a22', attempt_number: 2 },
  ],
}

function renderTab(focusTopicId: string | null = null) {
  return render(
    <MemoryRouter>
      <CourseHomeworkTab courseId="c1" modules={[]} groupName="11А" focusTopicId={focusTopicId} />
    </MemoryRouter>,
  )
}
const names = () => screen.getAllByTestId('hw-name').map(n => n.textContent)

beforeEach(() => {
  rpcSpy.mockClear()
  rpcResult = { data: JOURNAL, error: null }
})

describe('Вкладка «Домашние задания» — журнал (§250)', () => {
  it('по умолчанию — «Таблица»: одна RPC course_homework_grades, разделы свёрнуты, в клетке раздела «X из Y»', async () => {
    renderTab()
    const table = await screen.findByTestId('hw-table')
    expect(rpcSpy).toHaveBeenCalledWith('course_homework_grades', { p_course_id: 'c1' })
    expect(screen.getByTestId('hw-view').querySelector('[aria-pressed="true"]')).toHaveTextContent('Таблица')
    expect(screen.getAllByTestId('hw-section-toggle').map(b => b.textContent)).toEqual(['№2 Векторы2 ДЗ ▸', '№3 Стереометрия1 ДЗ ▸'])
    expect(within(table).queryAllByTestId('hw-col')).toHaveLength(0)
    expect(screen.getByTestId('hw-journal-meta')).toHaveTextContent('3 ДЗ выдано · ждут проверки 1 · просрочено 1')

    const sums = screen.getAllByTestId('hw-sum')
    // Абрамова: векторы 2 из 2 (зелёный), стереометрия 0 из 1 (дораб., без просрочки)
    expect(sums[0]).toHaveTextContent('2 из 2')
    expect(sums[0]).toHaveAttribute('data-tone', 'ok')
    expect(sums[1]).toHaveTextContent('0 из 1')
    // Белов: векторы 0 из 2, просроч. 1 — красным
    expect(sums[2]).toHaveTextContent('0 из 2')
    expect(sums[2]).toHaveTextContent('просроч. 1')
    expect(sums[2]).toHaveAttribute('data-tone', 'bad')
  })

  it('нажатие на раздел раскрывает ДЗ его тем: ✓, оценка, просроч. (срок прошёл), ждёт; повторное — сворачивает', async () => {
    renderTab()
    await screen.findByTestId('hw-table')
    const toggle = screen.getAllByTestId('hw-section-toggle')[0]
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTestId('hw-col').map(c => c.textContent)).toEqual(['Сложение векторовдо 20 сент', 'Координатыдо 10 окт'])
    const states = screen.getAllByTestId('hw-cell').map(c => [c.getAttribute('data-state'), c.textContent])
    expect(states).toEqual([['accepted', '✓'], ['grade', '5'], ['late', 'просроч.'], ['wait', 'ждёт']])
    fireEvent.click(toggle)
    expect(screen.queryAllByTestId('hw-col')).toHaveLength(0)
  })

  it('ДЗ без срока, ничего не сдано — «—», не «просроч.»', async () => {
    renderTab()
    await screen.findByTestId('hw-table')
    fireEvent.click(screen.getAllByTestId('hw-section-toggle')[1])
    expect(screen.getAllByTestId('hw-cell').map(c => c.getAttribute('data-state'))).toEqual(['returned', 'empty'])
  })

  it('нажатие на клетку ДЗ — строка с переходом к работе ученика в очереди проверки', async () => {
    renderTab()
    await screen.findByTestId('hw-table')
    fireEvent.click(screen.getAllByTestId('hw-section-toggle')[0])
    fireEvent.click(screen.getByRole('button', { name: 'Белов Кирилл, Координаты: ждёт проверки' }))
    const detail = screen.getByTestId('hw-detail')
    expect(detail).toHaveTextContent('Белов Кирилл · Координаты')
    expect(within(detail).getByRole('link', { name: 'Проверить' })).toHaveAttribute('href', '/homework-queue?attempt=a22')
    fireEvent.click(screen.getByRole('button', { name: 'Абрамова Софья, Координаты: оценка 5' }))
    expect(within(screen.getByTestId('hw-detail')).getByRole('link', { name: 'Открыть работу' })).toHaveAttribute('href', '/homework-queue?attempt=a12')
  })

  it('«Сначала отстающие» поднимает того, у кого просрочки', async () => {
    renderTab()
    await screen.findByTestId('hw-table')
    expect(names()).toEqual(['Абрамова Софья', 'Белов Кирилл'])
    fireEvent.click(screen.getByTestId('hw-sort-behind'))
    expect(screen.getByTestId('hw-sort-behind')).toHaveAttribute('aria-pressed', 'true')
    expect(names()).toEqual(['Белов Кирилл', 'Абрамова Софья'])
  })

  it('«По темам» — прежний список; журнал тогда не запрашивается', async () => {
    renderTab()
    await screen.findByTestId('hw-table')
    fireEvent.click(screen.getByRole('button', { name: 'По темам' }))
    expect(screen.getByTestId('by-topics')).toBeInTheDocument()
    expect(screen.queryByTestId('hw-table')).not.toBeInTheDocument()
  })

  it('focusTopicId (ссылки «Работы» / «Кто пишет», §241) открывает «По темам» с этой темой', () => {
    renderTab('kr-1')
    expect(screen.getByTestId('by-topics')).toHaveAttribute('data-focus', 'kr-1')
    expect(screen.getByRole('button', { name: 'По темам' })).toHaveAttribute('aria-pressed', 'true')
    expect(rpcSpy).not.toHaveBeenCalled()
  })

  it('без миграции (ошибка RPC) — объяснение и переход «по темам»', async () => {
    rpcResult = { data: null, error: { message: 'function course_homework_grades does not exist' } }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderTab()
    const err = await screen.findByTestId('hw-journal-error')
    fireEvent.click(within(err).getByRole('button', { name: 'по темам' }))
    expect(screen.getByTestId('by-topics')).toBeInTheDocument()
  })

  it('выданных ДЗ нет — объяснение, а не пустая таблица', async () => {
    rpcResult = { data: { ...JOURNAL, homeworks: JOURNAL.homeworks.map(h => ({ ...h, topic_open: false })), cells: [] }, error: null }
    renderTab()
    expect(await screen.findByTestId('hw-journal-empty')).toHaveTextContent('Выданных домашних заданий пока нет')
  })
})
