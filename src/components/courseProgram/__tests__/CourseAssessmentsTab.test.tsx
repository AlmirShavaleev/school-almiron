/**
 * §249. Вкладка «Проверочные и контрольные»: список работ со статистикой
 * (распределение, «Проверить N» → очередь по теме), журнал «ученик × работа»
 * (клетка → строка с переходом к работе ученика, «Сначала слабые», фильтр
 * типа), пробники §241, пустое состояние и журнал без миграции.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const NOW = Date.now()
const at = (mins: number) => new Date(NOW + mins * 60_000).toISOString()
const DAY = 24 * 60

let summary: { data: unknown; error: { message: string } | null }
let grades: { data: unknown; error: { message: string } | null }
const rpc = vi.fn((fn: string) => Promise.resolve(fn === 'course_assessment_grades' ? grades : summary))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string) => rpc(fn),
    from: () => {
      const c: Record<string, unknown> = {
        select: () => c, eq: () => c, order: () => c,
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
      }
      return c
    },
  },
}))
vi.mock('@/store/authStore', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'p', role: 'teacher' } }) }))
const exportSpy = vi.fn()
vi.mock('@/utils/exportExcel', () => ({ exportAssessmentGrades: (...a: unknown[]) => exportSpy(...a) }))

import { CourseAssessmentsTab } from '@/components/courseProgram/CourseAssessmentsTab'

const STUDENTS = [
  ['s1', 'Белов Кирилл'], ['s2', 'Абрамова Софья'], ['s3', 'Гарипова Алина'], ['s4', 'Валиев Тимур'],
].map(([student_id, name]) => ({ student_id, name }))

const WORKS = [
  { topic_id: 'der', kind: 'check', title: 'Производные', opens_at: at(-2 * DAY), closes_at: at(-2 * DAY + 45), grade_scale: 'five' },
  { topic_id: 'kr', kind: 'control', title: 'КР №1', opens_at: at(-DAY), closes_at: at(-DAY + 90), grade_scale: 'five' },
]
const CELL: Record<string, Record<string, [string, number | null]>> = {
  der: { s1: ['reviewed', 5], s2: ['reviewed', 2], s3: ['submitted', null], s4: ['draft', null] },
  kr: { s1: ['reviewed', 4], s2: ['reviewed', 2], s3: ['reviewed', 3], s4: ['none', null] },
}
const GRADES = {
  server_now: at(0), is_template: false, group_id: 'g1', group_name: '11А', students: STUDENTS,
  works: WORKS,
  cells: WORKS.flatMap(w => STUDENTS.map(s => {
    const [status, score] = CELL[w.topic_id][s.student_id]
    return { topic_id: w.topic_id, student_id: s.student_id, status, score, attempt_id: status === 'none' ? null : `att-${w.topic_id}-${s.student_id}`, attempt_number: 1, auto_submitted: false }
  })),
}
const SUMMARY = {
  server_now: at(0), is_template: false, group_id: 'g1', group_name: '11А', in_class: 4,
  works: [
    { topic_id: 'kr', kind: 'control', title: 'КР №1', published: true, opens_at: WORKS[1].opens_at, closes_at: WORKS[1].closes_at, grade_scale: 'five', status: 'done', submitted: 3, pending: 0, reviewed: 3, avg_score: 3, writing: 0, personal_live: 0 },
    { topic_id: 'der', kind: 'check', title: 'Производные', published: true, opens_at: WORKS[0].opens_at, closes_at: WORKS[0].closes_at, grade_scale: 'five', status: 'review', submitted: 3, pending: 1, reviewed: 2, avg_score: 3.5, writing: 0, personal_live: 0 },
  ],
  mocks: [
    { id: 'p4', title: 'Пробник №4', template_id: 't', starts_at: at(-6 * DAY), ends_at: at(-6 * DAY + 235), status: 'done', submitted: 3, pending: 0, avg_score: 63, writing: 0, in_group: 4 },
  ],
}

function draw(props: Partial<Parameters<typeof CourseAssessmentsTab>[0]> = {}) {
  const fns = { onOpenTopic: vi.fn(), onShowWorks: vi.fn(), onGoToProgram: vi.fn() }
  render(
    <MemoryRouter>
      <CourseAssessmentsTab courseId="c1" isTemplate={false} groupId="g1" groupName="11А" {...fns} {...props} />
    </MemoryRouter>,
  )
  return fns
}

const names = () => screen.getAllByTestId('grades-name').map(n => n.textContent)

beforeEach(() => {
  rpc.mockClear()
  exportSpy.mockClear()
  summary = { data: SUMMARY, error: null }
  grades = { data: GRADES, error: null }
})

describe('Работы', () => {
  it('по дате, со статусом, «сдали X из Y», распределением и кнопками', async () => {
    const { onShowWorks } = draw()
    const rows = await screen.findAllByTestId('assessments-work-row')
    expect(rows.map(r => r.getAttribute('data-kind'))).toEqual(['check', 'control'])
    expect(rows[0]).toHaveTextContent('Проверочная')
    expect(rows[0]).toHaveTextContent('Производные')
    expect(within(rows[0]).getByTestId('assessments-work-status')).toHaveTextContent('проверить 1')
    expect(within(rows[0]).getByTestId('assessments-work-submitted')).toHaveTextContent('сдали 3 из 4')
    expect(within(rows[0]).getByTestId('assessments-work-dist')).toHaveTextContent('5: 14: 03: 02: 1ждут: 1средний 3,5')
    expect(within(rows[0]).getByRole('link', { name: 'Проверить 1' })).toHaveAttribute('href', '/homework-queue?topic=der')
    expect(rows[1]).toHaveTextContent('КР')
    expect(within(rows[1]).getByTestId('assessments-work-status')).toHaveTextContent('проверена')
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Работы' }))
    expect(onShowWorks).toHaveBeenCalledWith('kr')
    expect(screen.getByTestId('assessments-works-meta')).toHaveTextContent('1 проверочная · 1 контрольная · ждут проверки 1')
  })

  it('пробники — блок §241 с «Добавить пробник»', async () => {
    draw()
    const mocks = await screen.findByTestId('course-mocks')
    expect(mocks).toHaveTextContent('Пробники')
    expect(mocks).toHaveTextContent('Пробник №4')
    expect(within(mocks).getByTestId('course-mock-add')).toHaveAttribute('href', '/mock-exams/new?group=g1')
    // Работы по времени во второй раз (блоками §241) не повторяются.
    expect(within(mocks).queryByText('Производные')).not.toBeInTheDocument()
  })
})

describe('Оценки по ученикам', () => {
  it('столбцы по типу, клетки «5/2/ждёт/—», средний по проверенным, строка класса, точка у 2+ двоек', async () => {
    draw()
    await screen.findByTestId('grades-table')
    expect(screen.getAllByTestId('grades-group').map(g => g.textContent)).toEqual(['Проверочные', 'Контрольные'])
    expect(screen.getAllByTestId('grades-col').map(c => c.firstChild?.textContent)).toEqual(['Производные', 'КР №1'])
    expect(names()).toEqual(['Абрамова Софья', 'Белов Кирилл', 'Валиев Тимур', 'Гарипова Алина'])
    const rows = screen.getAllByTestId('grades-row')
    const cells = (i: number) => within(rows[i]).getAllByTestId('grades-cell').map(c => c.textContent)
    expect(cells(0)).toEqual(['2', '2'])
    expect(cells(2)).toEqual(['—', '—']) // черновик и «не сдавал»
    expect(cells(3)).toEqual(['ждёт', '3'])
    expect(rows.map(r => within(r).getByTestId('grades-avg').textContent)).toEqual(['2,0', '4,5', '—', '3,0'])
    expect(screen.getAllByTestId('grades-class-avg').map(c => c.textContent)).toEqual(['3,5', '3,0'])
    expect(rows[0]).toHaveAttribute('data-flagged', 'true')
    expect(within(rows[0]).getByTestId('grades-flag')).toBeInTheDocument()
    expect(rows[1]).toHaveAttribute('data-flagged', 'false')
    expect(screen.getByTestId('assessments-journal-meta')).toHaveTextContent('4 ученика · две и больше двоек у 1')
  })

  it('нажатие на оценку — строка с работой ученика и «Открыть работу»; на «ждёт» — «Проверить»', async () => {
    draw()
    await screen.findByTestId('grades-table')
    fireEvent.click(screen.getByRole('button', { name: 'Белов Кирилл, Производные: 5' }))
    let detail = screen.getByTestId('grades-detail')
    expect(detail).toHaveTextContent('Белов Кирилл · Производные')
    expect(detail).toHaveTextContent('оценка 5')
    expect(within(detail).getByRole('link', { name: 'Открыть работу' })).toHaveAttribute('href', '/homework-queue?attempt=att-der-s1')

    fireEvent.click(screen.getByRole('button', { name: 'Гарипова Алина, Производные: ждёт проверки' }))
    detail = screen.getByTestId('grades-detail')
    expect(detail).toHaveTextContent('сдал, ждёт проверки')
    expect(within(detail).getByRole('link', { name: 'Проверить' })).toHaveAttribute('href', '/homework-queue?attempt=att-der-s3')
    // «—» — не кнопка: открывать нечего.
    expect(screen.getAllByTestId('grades-cell').filter(c => c.getAttribute('data-state') === 'empty').every(c => c.tagName === 'SPAN')).toBe(true)
  })

  it('«Сначала слабые» — по среднему, без оценок — в конце', async () => {
    draw()
    await screen.findByTestId('grades-table')
    fireEvent.click(within(screen.getByTestId('grades-sort')).getByRole('button', { name: 'Сначала слабые' }))
    expect(names()).toEqual(['Абрамова Софья', 'Гарипова Алина', 'Белов Кирилл', 'Валиев Тимур'])
    expect(within(screen.getByTestId('grades-sort')).getByRole('button', { name: 'Сначала слабые' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('фильтр «Контрольные» — только КР, точка у имени пересчитана', async () => {
    draw()
    await screen.findByTestId('grades-table')
    fireEvent.click(within(screen.getByTestId('grades-kind')).getByRole('button', { name: 'Контрольные' }))
    expect(screen.getAllByTestId('grades-col').map(c => c.firstChild?.textContent)).toEqual(['КР №1'])
    expect(screen.getAllByTestId('grades-group').map(g => g.textContent)).toEqual(['Контрольные'])
    expect(screen.queryAllByTestId('grades-flag')).toHaveLength(0)
  })

  it('«Скачать таблицу (Excel)» — выгружает то, что на экране', async () => {
    draw()
    await screen.findByTestId('grades-table')
    fireEvent.click(screen.getByTestId('grades-export'))
    await waitFor(() => expect(exportSpy).toHaveBeenCalledTimes(1))
    const [sheet, group] = exportSpy.mock.calls[0] as [(string | number)[][], string]
    expect(group).toBe('11А')
    expect(sheet[1]).toEqual(['Абрамова Софья', 2, 2, 2])
    expect(sheet[sheet.length - 1][0]).toBe('Средний по классу')
  })

  it('журнал недоступен (миграция не применена) — работы остаются, на месте журнала объяснение', async () => {
    grades = { data: null, error: { message: 'function course_assessment_grades does not exist' } }
    draw()
    expect(await screen.findByTestId('assessments-journal-error')).toHaveTextContent('Журнал оценок сейчас недоступен')
    expect(screen.getAllByTestId('assessments-work-row')).toHaveLength(2)
    expect(screen.queryByTestId('assessments-work-dist')).not.toBeInTheDocument()
  })
})

describe('Пусто и каркас', () => {
  it('работ нет — объяснение, как сделать тему проверочной, и одна кнопка к программе', async () => {
    summary = { data: { ...SUMMARY, works: [], mocks: [] }, error: null }
    grades = { data: { ...GRADES, works: [], cells: [] }, error: null }
    const { onGoToProgram } = draw()
    const empty = await screen.findByTestId('assessments-empty')
    expect(empty).toHaveTextContent('Проверочных и контрольных пока нет')
    expect(empty).toHaveTextContent('Тип темы')
    expect(empty).toHaveTextContent('«Проверочная работа» или «Контрольная работа»')
    expect(screen.queryByTestId('assessments-journal')).not.toBeInTheDocument()
    fireEvent.click(within(empty).getByRole('button', { name: 'Открыть программу курса' }))
    expect(onGoToProgram).toHaveBeenCalled()
    // Пробников нет — блок всё равно есть: из него добавляют пробник.
    expect(screen.getByTestId('course-mocks')).toHaveTextContent('Пробников пока нет.')
  })

  it('каркас — только список работ: без журнала, пробников и запроса журнала', async () => {
    summary = { data: { ...SUMMARY, is_template: true, group_id: null, group_name: null, in_class: 0, mocks: [], works: SUMMARY.works.map(w => ({ ...w, status: 'unscheduled', opens_at: null, closes_at: null })) }, error: null }
    const { onOpenTopic } = draw({ isTemplate: true, groupId: null, groupName: null })
    const rows = await screen.findAllByTestId('assessments-work-row')
    expect(rows).toHaveLength(2)
    expect(screen.getByTestId('assessments-works-meta')).toHaveTextContent('каркас: окно, сдача и оценки — в классах')
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Окно темы' }))
    expect(onOpenTopic).toHaveBeenCalled()
    expect(screen.queryByTestId('assessments-journal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('course-mocks')).not.toBeInTheDocument()
    expect(rpc.mock.calls.map(c => c[0])).not.toContain('course_assessment_grades')
  })
})
