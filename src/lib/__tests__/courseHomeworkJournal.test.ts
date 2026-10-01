import { describe, expect, it } from 'vitest'
import {
  homeworkJournalSheet, homeworkJournalView, hwCellView, isIssued, journalMetaText, moduleClassStats,
  parseHomeworkGrades, shortDay, topicClassStats, type CourseHomeworkGrades,
} from '@/lib/courseHomeworkJournal'

/**
 * §250. Журнал ДЗ: клетка по статусу и сроку, «выдано», сводка раздела
 * «X из Y», «Сначала отстающие», строка класса во вкладке «Курс», выгрузка.
 */

const TODAY = '2026-10-01'

function raw(over: Record<string, unknown> = {}) {
  return {
    server_now: '2026-10-01T09:00:00Z',
    today: TODAY,
    is_template: false,
    group_id: 'g1',
    group_name: '11А',
    students: [{ student_id: 's1', name: 'Белов Кирилл' }, { student_id: 's2', name: 'Абрамова Софья' }, { student_id: 's3', name: 'Валиев Тимур' }],
    homeworks: [
      // Раздел «Векторы» (order 2): срок прошёл, без шкалы; срок впереди, пятибалльная.
      { topic_id: 't1', homework_id: 'h1', module_id: 'm2', module_title: '№2 Векторы', module_order: 2, topic_title: 'Векторы: сложение', topic_order: 1, hw_title: 'ДЗ 1', due_at: '2026-09-25', grade_scale: null, topic_open: true },
      { topic_id: 't2', homework_id: 'h2', module_id: 'm2', module_title: '№2 Векторы', module_order: 2, topic_title: 'Векторы: координаты', topic_order: 2, hw_title: 'ДЗ 2', due_at: '2026-10-05', grade_scale: 'five', topic_open: true },
      // Раздел «Планиметрия» (order 1) — раньше «Векторов», хотя пришёл позже.
      { topic_id: 't3', homework_id: 'h3', module_id: 'm1', module_title: '№1 Планиметрия', module_order: 1, topic_title: 'Треугольники', topic_order: 1, hw_title: null, due_at: null, grade_scale: 'hundred', topic_open: true },
      // Закрытая тема без сдач — не выдано.
      { topic_id: 't4', homework_id: 'h4', module_id: 'm3', module_title: '№9 Задачи', module_order: 9, topic_title: 'Закрытая', topic_order: 1, hw_title: null, due_at: '2026-09-01', grade_scale: null, topic_open: false },
    ],
    cells: [
      { topic_id: 't1', student_id: 's1', status: 'reviewed', score: null, attempt_id: 'a11', attempt_number: 1 },
      { topic_id: 't1', student_id: 's2', status: 'draft', score: null, attempt_id: 'a12', attempt_number: 1 },
      // s3 по t1 — попыток нет, срок прошёл → «просроч.»
      { topic_id: 't2', student_id: 's1', status: 'submitted', score: null, attempt_id: 'a21', attempt_number: 2 },
      { topic_id: 't2', student_id: 's2', status: 'reviewed', score: 4, attempt_id: 'a22', attempt_number: 1 },
      { topic_id: 't2', student_id: 's3', status: 'returned', score: null, attempt_id: 'a23', attempt_number: 1 },
      { topic_id: 't3', student_id: 's1', status: 'reviewed', score: 92, attempt_id: 'a31', attempt_number: 1 },
    ],
    ...over,
  }
}
const data = () => parseHomeworkGrades(raw()) as CourseHomeworkGrades

describe('разбор ответа course_homework_grades', () => {
  it('мусор — null; даты — как календарные дни; неизвестный статус — none', () => {
    expect(parseHomeworkGrades(null)).toBeNull()
    expect(parseHomeworkGrades([1, 2])).toBeNull()
    const d = parseHomeworkGrades(raw({ cells: [{ topic_id: 't1', student_id: 's1', status: 'weird' }] }))!
    expect(d.today).toBe(TODAY)
    expect(d.homeworks[0].due_at).toBe('2026-09-25')
    expect(d.cells[0].status).toBe('none')
  })

  it('без today — берётся московская дата server_now', () => {
    const d = parseHomeworkGrades(raw({ today: null, server_now: '2026-09-30T22:30:00Z' }))!
    // 22:30 UTC 30 сентября — это уже 1 октября по Москве.
    expect(d.today).toBe('2026-10-01')
  })
})

describe('клетка ДЗ', () => {
  const noScale = { due_at: '2026-09-25', grade_scale: null } as const
  const five = { due_at: '2026-10-05', grade_scale: 'five' } as const

  it('принято без шкалы — ✓; со шкалой — оценка цветом; стобалльная — цвет по переводу', () => {
    expect(hwCellView({ topic_id: 't', student_id: 's', status: 'reviewed', score: null, attempt_id: 'a', attempt_number: 1 }, noScale, TODAY)).toMatchObject({ kind: 'accepted', text: '✓', attemptId: 'a' })
    expect(hwCellView({ topic_id: 't', student_id: 's', status: 'reviewed', score: 4, attempt_id: 'a', attempt_number: 1 }, five, TODAY)).toMatchObject({ kind: 'grade', text: '4', tone: 4 })
    expect(hwCellView({ topic_id: 't', student_id: 's', status: 'reviewed', score: 92, attempt_id: 'a', attempt_number: 1 }, { due_at: null, grade_scale: 'hundred' }, TODAY)).toMatchObject({ kind: 'grade', text: '92', tone: 5 })
    // Шкала есть, а балл не поставлен — тоже просто «принято».
    expect(hwCellView({ topic_id: 't', student_id: 's', status: 'reviewed', score: null, attempt_id: 'a', attempt_number: 1 }, five, TODAY).kind).toBe('accepted')
  })

  it('ждёт, дораб.', () => {
    expect(hwCellView({ topic_id: 't', student_id: 's', status: 'submitted', score: null, attempt_id: 'a', attempt_number: 1 }, noScale, TODAY)).toMatchObject({ kind: 'wait', text: 'ждёт' })
    expect(hwCellView({ topic_id: 't', student_id: 's', status: 'returned', score: null, attempt_id: 'a', attempt_number: 1 }, noScale, TODAY)).toMatchObject({ kind: 'returned', text: 'дораб.' })
  })

  it('«просроч.» — срок due_at прошёл, а сдачи нет (нет попытки или только черновик); в день срока — ещё не просрочено', () => {
    expect(hwCellView(undefined, noScale, TODAY)).toMatchObject({ kind: 'late', text: 'просроч.' })
    expect(hwCellView({ topic_id: 't', student_id: 's', status: 'draft', score: null, attempt_id: 'd', attempt_number: 1 }, noScale, TODAY)).toMatchObject({ kind: 'late', attemptId: 'd' })
    expect(hwCellView(undefined, { due_at: TODAY, grade_scale: null }, TODAY)).toMatchObject({ kind: 'empty', text: '—' })
    expect(hwCellView(undefined, five, TODAY)).toMatchObject({ kind: 'empty' })
    expect(hwCellView(undefined, { due_at: null, grade_scale: null }, TODAY)).toMatchObject({ kind: 'empty' })
  })
})

describe('журнал: столбцы-разделы и строки-ученики', () => {
  it('разделы — по порядку раздела; закрытая тема без сдач не выдана; сдававшие — выдана', () => {
    const v = homeworkJournalView(data(), { sort: 'name' })
    expect(v.sections.map(s => s.title)).toEqual(['№1 Планиметрия', '№2 Векторы'])
    expect(v.sections[1].columns.map(c => c.hw.topic_id)).toEqual(['t1', 't2'])
    expect(v.sections[1].columns.map(c => c.dueLabel)).toEqual(['до 25 сент', 'до 5 окт'])
    expect(v.sections[0].columns[0].dueLabel).toBe('без срока')
    const d = data()
    expect(isIssued(d.homeworks[3], d.cells)).toBe(false)
    expect(isIssued(d.homeworks[3], [...d.cells, { topic_id: 't4', student_id: 's1', status: 'submitted', score: null, attempt_id: 'x', attempt_number: 1 }])).toBe(true)
  })

  it('клетка раздела «X из Y» принято из выданных + «просроч. N» / «ждёт N»; тон: красный при просрочке, зелёный — всё принято', () => {
    const v = homeworkJournalView(data(), { sort: 'name' })
    const row = (name: string) => v.rows.find(r => r.student.name === name)!
    // Белов: t1 ✓, t2 ждёт → «1 из 2», «ждёт 1»
    expect(row('Белов Кирилл').sections[1].summary).toMatchObject({ text: '1 из 2', note: 'ждёт 1', tone: 'plain' })
    // Абрамова: t1 черновик при прошедшем сроке → просроч., t2 — 4 → «1 из 2», «просроч. 1», красный
    expect(row('Абрамова Софья').sections[1].summary).toMatchObject({ text: '1 из 2', note: 'просроч. 1', tone: 'bad' })
    expect(row('Абрамова Софья').sections[1].cells.map(c => c.text)).toEqual(['просроч.', '4'])
    // Белов в планиметрии — 92 из 100: «1 из 1», зелёный
    expect(row('Белов Кирилл').sections[0].summary).toMatchObject({ text: '1 из 1', tone: 'ok' })
    expect(v.pending).toBe(1)
    expect(v.late).toBe(2)
    expect(journalMetaText(v)).toBe('3 ДЗ выдано · ждут проверки 1 · просрочено 2')
  })

  it('«Сначала отстающие»: больше просрочек — выше, при равенстве — меньше принятого; иначе по алфавиту', () => {
    expect(homeworkJournalView(data(), { sort: 'name' }).rows.map(r => r.student.name)).toEqual(['Абрамова Софья', 'Белов Кирилл', 'Валиев Тимур'])
    // Абрамова: просроч. 1, принято 1; Валиев: просроч. 1, принято 0; Белов: 0 просрочек.
    expect(homeworkJournalView(data(), { sort: 'behind' }).rows.map(r => r.student.name)).toEqual(['Валиев Тимур', 'Абрамова Софья', 'Белов Кирилл'])
  })

  it('выгрузка: все разделы раскрыты, итог и просрочено в конце', () => {
    const sheet = homeworkJournalSheet(homeworkJournalView(data(), { sort: 'name' }))
    expect(sheet[0]).toEqual([
      'Ученик', '№1 Планиметрия: принято из выданных', '№1 Планиметрия · Треугольники',
      '№2 Векторы: принято из выданных', '№2 Векторы · Векторы: сложение (до 25 сент)', '№2 Векторы · Векторы: координаты (до 5 окт)',
      'Всего принято', 'Просрочено',
    ])
    expect(sheet[2]).toEqual(['Белов Кирилл', '1 из 1', 92, '1 из 2', 'принято', 'ждёт проверки', '2 из 3', 0])
    expect(sheet[1]).toEqual(['Абрамова Софья', '0 из 1', '—', '1 из 2', 'просрочено', 4, '1 из 3', 1])
  })
})

describe('строка класса (вкладка «Курс»)', () => {
  it('по теме: сдали (ждёт/принято/вернули), ждут, просрочили, средний по оценкам', () => {
    const s = topicClassStats(data())
    expect(s.get('t1')).toMatchObject({ inClass: 3, submitted: 1, pending: 0, accepted: 1, late: 2, avgFive: null, dueAt: '2026-09-25', issued: true })
    expect(s.get('t2')).toMatchObject({ submitted: 3, pending: 1, accepted: 1, late: 0, avgFive: 4 })
    expect(s.get('t4')).toMatchObject({ issued: false })
  })

  it('по разделу: только выданные ДЗ; средний — по всем оценкам раздела в пятибалльной', () => {
    const d = data()
    const s = topicClassStats(d)
    expect(moduleClassStats(d, s, ['t1', 't2'])).toEqual({ homeworks: 2, submitted: 4, pending: 1, late: 2, avgFive: 4 })
    expect(moduleClassStats(d, s, ['t4', 'x'])).toEqual({ homeworks: 0, submitted: 0, pending: 0, late: 0, avgFive: null })
  })

  it('короткая дата', () => {
    expect(shortDay('2026-11-09')).toBe('9 нояб')
    expect(shortDay(null)).toBe('—')
  })
})
