import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

/**
 * §259. Таблица ДЗ «По темам» у учителя: в строке темы — срок («Срок: до …» и
 * «изменить»; без срока — «Срок не задан · задать») и сводка «вовремя ·
 * с опозданием · не сдали»; в таблице — колонка «Срок» по первой сдаче (то же
 * правило, что «ДЗ вовремя» в наградах). У проверочной/контрольной срока нет —
 * у неё окно. «изменить / задать» не редактирует здесь, а зовёт окно темы.
 */

const MODULES = [{
  id: 'mod-1',
  title: 'Кинематика',
  topics: [
    { id: 't-past', title: 'Равноускоренное движение', is_open: true, available_from: null, kind: 'lesson' },
    { id: 't-soon', title: 'Свободное падение', is_open: true, available_from: null, kind: 'lesson' },
    { id: 't-today', title: 'Движение по окружности', is_open: true, available_from: null, kind: 'lesson' },
    { id: 't-nodue', title: 'Законы Ньютона', is_open: true, available_from: null, kind: 'lesson' },
    { id: 't-kr', title: 'Контрольная. Кинематика', is_open: true, available_from: null, kind: 'control' },
  ],
}]
const NAMES = ['Абрамова', 'Белов', 'Валиев', 'Гарипова', 'Давыдов', 'Евсеева', 'Жуков']
const ROSTER = NAMES.map((name, i) => ({ student_id: `s${i + 1}`, students: { id: `s${i + 1}`, profiles: { full_name: name } } }))
const HOMEWORKS = [
  { id: 'h-past', topic_id: 't-past', title: 'ДЗ', grade_scale: 'five', is_published: true, due_at: '2026-09-11' },
  { id: 'h-soon', topic_id: 't-soon', title: 'ДЗ', grade_scale: null, is_published: true, due_at: '2026-10-05' },
  { id: 'h-today', topic_id: 't-today', title: 'ДЗ', grade_scale: null, is_published: true, due_at: '2026-10-02' },
  { id: 'h-nodue', topic_id: 't-nodue', title: 'ДЗ', grade_scale: null, is_published: true, due_at: null },
  { id: 'h-kr', topic_id: 't-kr', title: 'КР', grade_scale: 'five', is_published: true, due_at: null, opens_at: '2026-10-02T07:00:00.000Z', closes_at: '2026-10-02T07:45:00.000Z' },
]
const att = (id: string, hw: string, student: string, n: number, status: string, submitted_at: string | null, score: number | null = null) => ({
  id, homework_id: hw, student_id: student, attempt_number: n, status, submitted_at, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  topic_homework_reviews: status === 'accepted' ? [{ decision: 'accepted', score, created_at: '2026-09-30T00:00:00Z' }] : [],
})
const ATTEMPTS = [
  att('a1', 'h-past', 's1', 1, 'accepted', '2026-09-07T14:15:00Z', 5), // до срока
  att('a2', 'h-past', 's2', 1, 'accepted', '2026-09-28T16:23:00Z', 4), // на 17 дней позже
  att('a3', 'h-past', 's3', 1, 'submitted', '2026-09-11T20:40:00Z'), // 23:40 МСК в день срока
  // s4 — ничего
  att('a5', 'h-past', 's5', 1, 'returned_for_revision', '2026-09-06T07:52:00Z'),
  // s6: вернули на доработку, пересдал после срока — всё равно вовремя (первая сдача)
  att('a6a', 'h-past', 's6', 1, 'returned_for_revision', '2026-09-06T07:52:00Z'),
  att('a6b', 'h-past', 's6', 2, 'submitted', '2026-09-20T10:00:00Z'),
  att('a7', 'h-past', 's7', 1, 'draft', null), // только черновик
  att('b1', 'h-soon', 's1', 1, 'submitted', '2026-10-01T10:00:00Z'),
]

function selectChain(rows: unknown) {
  const c: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) c[m] = () => c
  c.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(f)
  return c
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'group_students') return selectChain(ROSTER)
      if (table === 'topic_homework') return selectChain(HOMEWORKS)
      if (table === 'topic_homework_attempts') return selectChain(ATTEMPTS)
      if (table === 'topic_homework_files') return selectChain(HOMEWORKS.map(h => ({ homework_id: h.id })))
      return selectChain([])
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  },
}))
vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), saved: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/courseProgram/TopicOpenToggle', () => ({ TopicOpenToggle: () => null }))

import { CourseTopicHomeworkSection } from '@/components/courseProgram/CourseTopicHomeworkSection'

const topicBox = (title: string) => screen.getByText(title).closest('[data-hw-topic]') as HTMLElement
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

beforeEach(() => {
  // «Сейчас» — пт 2 октября 2026, 12:30 МСК. Только Date: таймеры настоящие.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-02T09:30:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('Срок ДЗ в таблице «По темам» (§259)', () => {
  it('в строке темы — срок, «изменить» и сводка «вовремя · с опозданием · не сдали»', async () => {
    const onEdit = vi.fn()
    render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} onEditDeadline={onEdit} />)
    await screen.findByText('Равноускоренное движение')
    const box = topicBox('Равноускоренное движение')
    expect(within(box).getByTestId('hw-due')).toHaveTextContent('Срок: до пт 11 сентизменить')
    expect(within(box).getByTestId('hw-due-summary').textContent).toBe('вовремя 4с опозданием 1не сдали 2')
    fireEvent.click(within(box).getByTestId('hw-due-edit'))
    expect(onEdit).toHaveBeenCalledWith('t-past')
  })

  it('колонка «Срок»: вовремя (и в 23:40 дня срока, и после пересдачи), опоздание, просрочено (и у черновика)', async () => {
    render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} />)
    fireEvent.click(await screen.findByText('Равноускоренное движение'))
    const box = topicBox('Равноускоренное движение')
    expect(within(box).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Ученик', 'Статус', 'Балл', 'Дата сдачи', 'Срок'])
    const chip = (name: string) => within(rowOf(name)).getByTestId('hw-deadline')
    expect(chip('Абрамова')).toHaveTextContent('вовремя')
    expect(chip('Белов')).toHaveTextContent('опоздание 17 дн.')
    expect(chip('Белов')).toHaveAttribute('data-kind', 'late')
    expect(chip('Валиев')).toHaveTextContent('вовремя')
    expect(chip('Гарипова')).toHaveTextContent('просрочено 21 дн.')
    expect(chip('Давыдов')).toHaveTextContent('вовремя')
    expect(within(rowOf('Давыдов')).getByText('На доработке')).toBeInTheDocument()
    expect(chip('Евсеева')).toHaveTextContent('вовремя')
    expect(chip('Жуков')).toHaveTextContent('просрочено 21 дн.')
  })

  it('срок не наступил — «ещё N дн.», в день срока — «сегодня срок»; сдавшие — «вовремя»', async () => {
    render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} />)
    fireEvent.click(await screen.findByText('Свободное падение'))
    fireEvent.click(screen.getByText('Движение по окружности'))
    const soon = topicBox('Свободное падение')
    expect(within(soon).getByTestId('hw-due-summary').textContent).toBe('вовремя 1с опозданием 0не сдали 6')
    const soonChips = within(soon).getAllByTestId('hw-deadline').map(c => c.textContent)
    expect(soonChips[0]).toBe('вовремя')
    expect(soonChips.slice(1)).toEqual(Array(6).fill('ещё 3 дн.'))
    const today = topicBox('Движение по окружности')
    expect(within(today).getAllByTestId('hw-deadline').map(c => c.textContent)).toEqual(Array(7).fill('сегодня срок'))
  })

  it('срок не задан — «Срок не задан · задать», сводки нет, в колонке «—»', async () => {
    const onEdit = vi.fn()
    render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} onEditDeadline={onEdit} />)
    fireEvent.click(await screen.findByText('Законы Ньютона'))
    const box = topicBox('Законы Ньютона')
    expect(within(box).getByTestId('hw-due')).toHaveTextContent('Срок не задан·задать')
    expect(within(box).getByTestId('hw-due')).toHaveAttribute('data-set', 'false')
    expect(within(box).queryByTestId('hw-due-summary')).toBeNull()
    expect(within(box).getAllByTestId('hw-deadline').map(c => c.textContent)).toEqual(Array(7).fill('—'))
    fireEvent.click(within(box).getByTestId('hw-due-edit'))
    expect(onEdit).toHaveBeenCalledWith('t-nodue')
  })

  it('у контрольной — ни срока, ни сводки, ни колонки «Срок»: у неё окно', async () => {
    render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} onEditDeadline={vi.fn()} />)
    fireEvent.click(await screen.findByText('Контрольная. Кинематика'))
    const box = topicBox('Контрольная. Кинематика')
    expect(within(box).queryByTestId('hw-due-line')).toBeNull()
    expect(within(box).queryByTestId('hw-deadline')).toBeNull()
    expect(within(box).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Ученик', 'Статус', 'Балл', 'Дата сдачи', 'Время'])
  })

  it('без обработчика (вне страницы курса) — срок виден, ссылки «изменить» нет', async () => {
    render(<CourseTopicHomeworkSection courseId="c1" modules={MODULES} />)
    await screen.findByText('Равноускоренное движение')
    expect(within(topicBox('Равноускоренное движение')).getByTestId('hw-due')).toHaveTextContent('Срок: до пт 11 сент')
    expect(screen.queryByTestId('hw-due-edit')).toBeNull()
  })
})
