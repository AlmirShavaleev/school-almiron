import { describe, expect, it } from 'vitest'
import {
  addDays, cellState, cellsFor, decodeBoard, formatWeekRange, isoWeekday, nextMonday,
  spreadConfirmText, weekEndDay, weekNumbers, weekReport, weekStartDay,
} from '@/lib/studyPlanBoard'

/**
 * Формат клетки — массив с битовыми флагами (миграция study_plan_board_compact).
 * Здесь единственная расшифровка, поэтому проверяем её по кодам, а не по
 * смыслу: смысл (зачёт, просрочка) считает база.
 */
const RAW = {
  plan: { start_date: '2026-09-07', auto_open: true, current_week: 1, weeks_total: 3 },
  students: [
    { student_id: 's-a', profile_id: 'p-a', full_name: 'Аминов' },
    { student_id: 's-b', profile_id: 'p-b', full_name: 'Борисов' },
  ],
  topics: [
    { topic_id: 't-1', title: 'Кинематика', module_title: 'Механика', week_no: 1, is_open: null, available_from: '2026-09-07', open_now: true },
    { topic_id: 't-2', title: 'Динамика', module_title: 'Механика', week_no: 1, is_open: null, available_from: '2026-09-07', open_now: true },
    { topic_id: 't-3', title: 'Статика', module_title: 'Механика', week_no: 2, is_open: null, available_from: '2026-09-14', open_now: false },
  ],
  cells: [
    // [si, ti, week, hw_code, self_groups, self_marked, flags, submitted_at?]
    [0, 0, 1, 3, 2, 2, 1 + 2 + 64, '2026-09-08T10:00:00+00:00'],  // сдано, отмечено, ДЗ опубликовано
    [0, 1, 1, 1, 2, 2, 2 + 64],                                    // отметил пройденным, ДЗ НЕ сдал
    [0, 2, 2, 0, 2, 0, 0],                                         // ДЗ не опубликовано, не пройдено
    [1, 0, 1, 1, 2, 0, 4 + 64],                                    // просрочено
    [1, 1, 1, 0, 2, 2, 1],                                         // ДЗ нет — пройдено по отметке
    [1, 2, 3, 0, 1, 0, 32],                                        // сдвинуто на неделю 3
  ],
  summary: [
    [0, 1, 2, 1, 0], [0, 2, 1, 0, 0],
    [1, 1, 2, 1, 1], [1, 3, 1, 0, 0],
  ],
}

describe('decodeBoard', () => {
  it('раскладывает массивы клеток по полям и флагам', () => {
    const board = decodeBoard(RAW)
    expect(board.plan?.weeks_total).toBe(3)
    expect(board.students).toHaveLength(2)
    expect(board.cells).toHaveLength(6)

    const submitted = board.cells[0]
    expect(submitted).toMatchObject({ si: 0, ti: 0, week: 1, hw: 'submitted', hwPublished: true, done: true, marked: true, overdue: false })
    expect(submitted.submittedAt).toBe('2026-09-08T10:00:00+00:00')

    const shifted = board.cells[5]
    expect(shifted).toMatchObject({ week: 3, shifted: true, removed: false, hw: 'none', hwPublished: false })
    expect(shifted.submittedAt).toBeNull()
  })

  it('null и мусор — пустая доска, а не падение', () => {
    expect(decodeBoard(null)).toEqual({ plan: null, students: [], topics: [], cells: [], summary: [] })
    expect(decodeBoard('x').cells).toEqual([])
  })
})

describe('cellState', () => {
  const board = decodeBoard(RAW)

  it('тема с ДЗ: сдано — зачёт по сдаче, отметка рядом', () => {
    const s = cellState(board.cells[0])
    expect(s.kind).toBe('done')
    expect(s.basis).toBe('homework')
    expect(s.label).toBe('ДЗ сдано')
    expect(s.marksLabel).toBe('отмечено пройденным')
    expect(s.markedButNotSubmitted).toBe(false)
  })

  it('расхождение: отметил пройденной, но ДЗ не сдал — видно отдельно', () => {
    const s = cellState(board.cells[1])
    expect(s.kind).toBe('waiting')
    expect(s.label).toBe('ДЗ не сдано')
    expect(s.markedButNotSubmitted).toBe(true)
  })

  it('без опубликованного ДЗ зачёт идёт по отметке и об этом сказано', () => {
    const notDone = cellState(board.cells[2])
    expect(notDone.basis).toBe('marks')
    expect(notDone.label).toBe('ещё не пройдено')
    expect(notDone.marksLabel).toBe('не отмечено')

    const done = cellState(board.cells[4])
    expect(done.kind).toBe('done')
    expect(done.label).toBe('пройдено')
  })

  it('просрочка и снятая тема', () => {
    expect(cellState(board.cells[3])).toMatchObject({ kind: 'overdue', label: 'просрочено' })
    const removed = cellState({ ...board.cells[3], removed: true })
    expect(removed).toMatchObject({ kind: 'removed', label: 'снята с плана' })
  })

  it('сдано после срока и частичные отметки', () => {
    const late = cellState({ ...board.cells[0], late: true })
    expect(late).toMatchObject({ kind: 'late', label: 'сдано после срока' })
    const partial = cellState({ ...board.cells[1], marked: false, selfMarked: 1 })
    expect(partial.marksLabel).toBe('отмечено 1 из 2')
    const none = cellState({ ...board.cells[1], marked: false, selfMarked: 0, selfGroups: 0 })
    expect(none.marksLabel).toBe('отмечать нечего')
  })
})

describe('недели и отчёт', () => {
  const board = decodeBoard(RAW)

  it('даты недели считаются от старта без часовых поясов', () => {
    expect(weekStartDay('2026-09-07', 1)).toBe('2026-09-07')
    expect(weekEndDay('2026-09-07', 1)).toBe('2026-09-13')
    expect(weekStartDay('2026-09-07', 4)).toBe('2026-09-28')
    expect(weekEndDay('2026-09-07', 4)).toBe('2026-10-04')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('диапазон недели: в одном месяце и через границу месяца', () => {
    expect(formatWeekRange('2026-09-07', 1)).toBe('7–13 сен')
    expect(formatWeekRange('2026-09-07', 4)).toBe('28 сен – 4 окт')
  })

  it('ближайший понедельник', () => {
    expect(isoWeekday('2026-09-07')).toBe(1)
    expect(isoWeekday('2026-09-13')).toBe(7)
    expect(nextMonday('2026-09-07')).toBe('2026-09-07')
    expect(nextMonday('2026-09-12')).toBe('2026-09-14')
    expect(nextMonday('2026-09-13')).toBe('2026-09-14')
  })

  it('номера недель включают сдвиги за пределы раскладки', () => {
    expect(weekNumbers(board)).toEqual([1, 2, 3])
  })

  it('отчёт по неделе раскладывает учеников по корзинам из сводки базы', () => {
    const r = weekReport(board, 1)
    expect(r.full).toHaveLength(0)
    expect(r.partial.map(x => x.student.full_name)).toEqual(['Аминов', 'Борисов'])
    expect(r.partial[1].overdue).toBe(1)

    const r2 = weekReport(board, 2)
    expect(r2.none.map(x => x.student.full_name)).toEqual(['Аминов'])
    expect(r2.empty.map(x => x.student.full_name)).toEqual(['Борисов'])
  })

  it('клетки ученика за неделю — в порядке программы', () => {
    expect(cellsFor(board, 0, 1).map(c => c.ti)).toEqual([0, 1])
    expect(cellsFor(board, 1, 3).map(c => c.ti)).toEqual([2])
  })

  it('подтверждение перекладки говорит прямо, что раскладка будет заменена', () => {
    const text = spreadConfirmText(3, true)
    expect(text).toContain('Текущая раскладка будет заменена')
    expect(text).toContain('по 3 в неделю')
    expect(text).toContain('Отклонения по ученикам')
    expect(spreadConfirmText(2, false)).not.toContain('заменена')
  })
})
