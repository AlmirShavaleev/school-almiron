import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ParentReportSheet } from '@/components/report/ParentReportSheet'
import type { ProgressReport } from '@/lib/parentReport'
import { buildForecastView, normalizeForecastResponse } from '@/lib/egeForecast'
import { EGE_SPECS } from '@/lib/egeScales'

/**
 * §217. Лист для родителя — то, что уносят домой.
 *
 * Главная проверка здесь одна: внутренней заметки преподавателя НЕТ В
 * РАЗМЕТКЕ. Не «скрыта», не `hidden`, не `display:none` — стиль отключают
 * расширением браузера, «Просмотреть код» и сохранением страницы; отсутствие
 * узла отключить нельзя.
 */

const SECRET = 'ВНУТРЕННЯЯ ЗАМЕТКА: бросает задачу на середине, если не выходит с первого подхода.'

const report: ProgressReport = {
  student: { id: 'st-1', full_name: 'Нурмухаметова Алина', grade: 11, groups: ['11А физика'] },
  period: { from: '2026-09-01', to: '2026-09-25' },
  generated_at: '2026-09-25T10:00:00+00:00',
  min_group_for_avg: 6,
  min_tasks_for_topic: 3,
  subjects: [
    {
      subject: 'physics', exam_type: 'ege', course_titles: 'Физика ЕГЭ',
      target: 75, avg_percent: 62, graded_works: 7,
      group_size: 9, group_avg_percent: 58,
      works: { submitted: 9, accepted: 7, revision: 1, pending: 1, with_due: 9, on_time: 7, late: 2 },
      weeks: [
        { week_start: '2026-09-01', avg_percent: 55, works: 2 },
        { week_start: '2026-09-08', avg_percent: 66, works: 2 },
        { week_start: '2026-09-15', avg_percent: 62, works: 3 },
      ],
      last_mock: {
        date: '2026-06-12', title: 'Пробник', score: 61, part1: 38, part2: 23,
        group_avg: 54, group_size: 9, delta: 6,
      },
    },
    {
      subject: 'math', exam_type: 'ege', course_titles: 'Математика профиль',
      target: null, avg_percent: 74, graded_works: 4,
      // Четыре человека в группе — среднее не печатается.
      group_size: 4, group_avg_percent: null,
      works: { submitted: 5, accepted: 4, revision: 0, pending: 1, with_due: 5, on_time: 5, late: 0 },
      weeks: [{ week_start: '2026-09-08', avg_percent: 74, works: 4 }],
      last_mock: null,
    },
  ],
  mocks: [
    { date: '2026-05-23', title: 'Пробник физика', subject: 'physics', exam_type: 'ege', score: 55, part1: 35, part2: 20, group_avg: 51, group_size: 9, delta: null },
    { date: '2026-06-10', title: 'Пробник математика', subject: 'math', exam_type: 'ege', score: 71, part1: 52, part2: 19, group_avg: null, group_size: 4, delta: null },
    { date: '2026-06-12', title: 'Пробник физика', subject: 'physics', exam_type: 'ege', score: 61, part1: 38, part2: 23, group_avg: 54, group_size: 9, delta: 6 },
  ],
  topics: {
    weak: [
      { topic_id: 'tp1', title: 'Термодинамика', subject: 'physics', ege_numbers: [24], tasks_counted: 9, correct_percent: 41 },
      { topic_id: 'tp2', title: 'Кинематика. Баллистика', subject: 'physics', ege_numbers: [], tasks_counted: 12, correct_percent: 52 },
    ],
    strong: [
      { topic_id: 'tp3', title: 'Оптика', subject: 'physics', ege_numbers: [6, 7], tasks_counted: 16, correct_percent: 95 },
    ],
    without_number: 1,
  },
  ege_numbers: [
    { number: 6, tasks_counted: 16, correct_percent: 95 },
    { number: 7, tasks_counted: 16, correct_percent: 95 },
    { number: 24, tasks_counted: 9, correct_percent: 41 },
  ],
  activity: {
    video_seconds: 12000, video_seconds_last_week: 2880,
    materials: 34, catalog_tasks: 12,
    with_due: 14, on_time: 12, late: 2,
  },
  next_steps: ['Разобрать термодинамику', 'Отбор корней', ''],
  teacher_note: { body: SECRET, created_at: '2026-09-20T10:00:00+00:00' },
}

describe('лист для родителя', () => {
  it('внутренней заметки преподавателя НЕТ В РАЗМЕТКЕ — не спрятана стилем', () => {
    const { container } = render(<ParentReportSheet report={report} />)

    // Ни текста, ни узла: не queryByText (он бы нашёл и скрытый), а именно
    // разметка целиком.
    expect(container.innerHTML).not.toContain(SECRET)
    expect(container.innerHTML).not.toContain('ВНУТРЕННЯЯ ЗАМЕТКА')
    expect(container.querySelector('[data-testid="report-teacher-note"]')).toBeNull()
    expect(container.querySelector('[hidden]')).toBeNull()
  })

  it('слова «ИИ» на листе нет: оценку поставил преподаватель', () => {
    const { container } = render(<ParentReportSheet report={report} />)
    expect(container.textContent).not.toMatch(/\bИИ\b/)
  })

  // §261: прежний тест «прогноза нет ни в каком виде» переписан осознанно (решение владельца 03.10) — прогноз
  // на листе есть, но только при достаточном покрытии; проверки — в блоке §261 ниже. Без поля forecast (база до
  // §261) строки прогноза нет вовсе.
  it('база до §261 (поля forecast нет) — ни строки прогноза, ни «мало данных»', () => {
    const { container } = render(<ParentReportSheet report={report} />)
    expect(container.textContent).not.toMatch(/прогноз/i)
    expect(container.textContent).not.toMatch(/Примерный балл/)
  })

  it('база до §261 (ДЗ периода в ответе нет): средний балл — прежний процент, вместе с числом работ', () => {
    render(<ParentReportSheet report={report} />)
    const physics = screen.getByTestId('report-subject-physics')
    expect(within(physics).getByText('Средний балл ДЗ')).toBeInTheDocument()
    expect(within(physics).getByText('62 %')).toBeInTheDocument()
    expect(within(physics).getByText('по 7 проверенным работам')).toBeInTheDocument()
  })

  // §261: ячейка «Среднее по группе» снята с листа 1 (на её месте «Проверочные» со средней по классу). Правило
  // приватности «от шести человек» действует для средней по классу у проверочных — тест в блоке §261.

  it('цели по математике нет — прочерк, а не ноль', () => {
    render(<ParentReportSheet report={report} />)
    const math = screen.getByTestId('report-subject-math')
    expect(within(math).getByText(/цель на экзамене — не задана/)).toBeInTheDocument()
  })

  it('темы печатаются с номером задания и числом заданий; «без номера» назван словом', () => {
    render(<ParentReportSheet report={report} />)
    expect(screen.getByText('№24')).toBeInTheDocument()
    expect(screen.getByText('№6, 7')).toBeInTheDocument()
    expect(screen.getByText('без номера')).toBeInTheDocument()
    expect(screen.getByText('Физика · 9 заданий')).toBeInTheDocument()
  })

  it('оба листа на месте и пронумерованы', () => {
    render(<ParentReportSheet report={report} />)
    expect(screen.getByTestId('parent-report-page-1')).toBeInTheDocument()
    expect(screen.getByTestId('parent-report-page-2')).toBeInTheDocument()
    expect(screen.getAllByText(/Лист 1 из 2/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Лист 2 из 2/).length).toBeGreaterThan(0)
  })

  it('«что делать до следующей встречи» печатается без пустой третьей строки', () => {
    render(<ParentReportSheet report={report} />)
    const next = screen.getByTestId('parent-report-next-steps')
    expect(within(next).getAllByRole('listitem')).toHaveLength(2)
  })

  it('пустой отчёт не печатает выдуманных нулей', () => {
    const empty: ProgressReport = {
      ...report,
      subjects: [], mocks: [], next_steps: [],
      topics: { weak: [], strong: [], without_number: 0 },
      ege_numbers: [],
      activity: { video_seconds: 0, video_seconds_last_week: 0, materials: 0, catalog_tasks: 0, with_due: 0, on_time: 0, late: 0 },
      teacher_note: null,
    }
    render(<ParentReportSheet report={empty} />)
    expect(screen.getByText(/показывать нечего/)).toBeInTheDocument()
    expect(screen.getByText(/Пробников у ученика пока нет/)).toBeInTheDocument()
    // §261: «Старание за период» без данных базы — прочерки с пометкой, а не нули.
    const dil = screen.getByTestId('parent-report-diligence')
    expect(within(dil).getAllByText('—').length).toBe(3)
  })

  it('имён других учеников на листе нет — только агрегаты', () => {
    const { container } = render(<ParentReportSheet report={report} />)
    expect(container.textContent).toContain('Нурмухаметова Алина')
    // Ни одной другой фамилии в отчёте быть неоткуда: база отдаёт только
    // среднее и размер группы.
    expect(container.textContent).not.toMatch(/Иванов|Петров/)
  })
})

// ── §261: прогноз при покрытии, проверочные, ДЗ вовремя, «Старание за период» ─────────────────────────────

const GEN = '2026-10-03T09:00:00Z'
const agoIso = (d: number) => new Date(Date.parse(GEN) - d * 86_400_000).toISOString()
const ev = (ns: number[], daysAgo = 2) => ns.flatMap(n => [1, 2, 3].map(k => ({
  subject: 'physics', ns: [n], source: 'hw', score: 1, at: agoIso(daysAgo), item: `hw:${n}:${k}`, kim_total: null,
})))
const forecast = (ns: number[], goal: number | null = 75, daysAgo = 2) => ({
  now: GEN, today: '2026-10-03', subjects: [{ subject: 'physics', goal, teacher_goal: null }],
  titles: [], numbers: [], catalog_rules: null, evidence: ev(ns, daysAgo),
})
const physics261 = {
  ...report.subjects[0],
  exam_goal: 75,
  assessments: [
    { date: '2026-09-19', title: 'Равномерное движение', kind: 'check', status: 'accepted', score: 5, grade_scale: 'five', points: 11, points_max: 12, class_avg: 4.2, class_size: 9 },
    { date: '2026-09-26', title: 'Кинематика: броски', kind: 'control', status: 'accepted', score: 4, grade_scale: 'five', points: null, points_max: null, class_avg: 3.9, class_size: 9 },
    { date: '2026-10-03', title: 'Движение по окружности', kind: 'check', status: 'accepted', score: 3, grade_scale: 'five', points: 10, points_max: 12, class_avg: null, class_size: 4 },
  ],
  homeworks: [
    { title: 'Динамика', due_at: '2026-10-01', first_submitted_at: '2026-10-01T20:40:00Z', status: 'accepted', score: 5, grade_scale: 'five' },
    { title: 'Силы', due_at: '2026-09-29', first_submitted_at: '2026-09-29T21:00:00Z', status: 'accepted', score: 4, grade_scale: 'five' },
    { title: 'Кинематика. Теория', due_at: '2026-09-22', first_submitted_at: null, status: null, score: null, grade_scale: 'five' },
    { title: 'Импульс', due_at: '2026-10-02', first_submitted_at: '2026-10-02T08:00:00Z', status: 'submitted', score: null, grade_scale: 'five' },
  ],
}
const report261: ProgressReport = {
  ...report,
  generated_at: GEN,
  period: { from: '2026-09-01', to: '2026-10-03' },
  subjects: [physics261],
  forecast: forecast([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  diligence: {
    solve_days: 19, period_days: 33, streak: 5, catalog_correct: 47,
    achievements_earned: 23, achievements_total: 79, level: { n: 7, name: 'Опыт' }, levels_count: 20,
  },
}

describe('§261 — лист 1: прогноз только при покрытии', () => {
  it('данных достаточно — «Примерный балл на ЕГЭ» той же моделью, цель ученика и «до цели»', () => {
    render(<ParentReportSheet report={report261} />)
    const row = screen.getByTestId('report-forecast-physics')
    const data = normalizeForecastResponse(report261.forecast)
    const view = buildForecastView(EGE_SPECS['physics:2026'], data!.evidence, data!.now)
    expect(within(row).getByText('Примерный балл на ЕГЭ')).toBeInTheDocument()
    expect(within(row).getByText(String(view.score))).toBeInTheDocument()
    expect(row.textContent).toContain(`цель 75 · до цели ${75 - view.score}`)
    expect(row.querySelector('svg[role="img"]')).not.toBeNull()
    expect(screen.queryByText(/Пока мало данных/)).toBeNull()
  })

  it('данных мало (9 номеров из 10) — строка «Пока мало данных для прогноза», числа нет', () => {
    render(<ParentReportSheet report={{ ...report261, forecast: forecast([1, 2, 3, 4, 5, 6, 7, 8, 9]) }} />)
    expect(screen.queryByTestId('report-forecast-physics')).toBeNull()
    const few = screen.getByTestId('report-forecast-few-physics')
    expect(few.textContent).toMatch(/^Пока мало данных для прогноза/)
    expect(few.textContent).toContain('сейчас 9 из 10')
  })

  it('цель ученика и цель учителя разные — подписано «цель ученика»', () => {
    render(<ParentReportSheet report={{ ...report261, subjects: [{ ...physics261, target: 70, exam_goal: 80 }], forecast: forecast([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 80) }} />)
    expect(screen.getByTestId('report-forecast-physics').textContent).toContain('цель ученика 80')
    expect(screen.getByText('цель на экзамене — 70 баллов')).toBeInTheDocument()
  })

  it('не ЕГЭ-предмет (математика ОГЭ) — строки прогноза нет, даже если у ученика есть ЕГЭ', () => {
    render(<ParentReportSheet report={{ ...report261, subjects: [{ ...physics261, subject: 'math', exam_type: 'oge' }] }} />)
    expect(screen.queryByText(/Примерный балл/)).toBeNull()
    expect(screen.queryByText(/мало данных/)).toBeNull()
  })
})

describe('§261 — лист 1: плитки и проверочные', () => {
  it('плитки как в макете: Средний балл ДЗ, Проверочные, ДЗ вовремя, Последний пробник', () => {
    render(<ParentReportSheet report={report261} />)
    const block = within(screen.getByTestId('report-subject-physics'))
    // ДЗ: принятые 5 и 4 → 4,5; две работы
    expect(block.getByText('4,5')).toBeInTheDocument()
    expect(block.getByText('2 проверенные работы')).toBeInTheDocument()
    // проверочные: 5, 4, 3 → 4,0; класс — только где база дала среднюю (4,2 и 3,9) → 4,05 → «4,1»
    expect(block.getByText('4,0')).toBeInTheDocument()
    expect(block.getByText('3 работы · класс 4,1')).toBeInTheDocument()
    // ДЗ вовремя по §259: Динамика (23:40 МСК дня срока) и Импульс — вовремя; Силы (00:00 МСК) — опоздание; Теория — не сдано
    expect(block.getByText('2 из 4')).toBeInTheDocument()
    expect(block.getByText('1 с опозданием, 1 не сдано')).toBeInTheDocument()
    expect(block.getByText('Последний пробник')).toBeInTheDocument()
    expect(block.queryByText('Среднее по группе')).toBeNull()
  })

  it('таблица проверочных: «10 из 12» где учитель ставил баллы, прочерк где нет; в маленьком классе средняя — прочерк с пояснением', () => {
    render(<ParentReportSheet report={report261} />)
    const t = within(screen.getByTestId('report-assessments-physics'))
    const rows = t.getAllByTestId('report-assessment-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByText('11 из 12')).toBeInTheDocument()
    expect(within(rows[0]).getByText('4,2')).toBeInTheDocument()
    expect(within(rows[1]).getAllByText('—')).toHaveLength(1)
    expect(within(rows[2]).getByText('10 из 12')).toBeInTheDocument()
    expect(within(rows[2]).getByText('—')).toBeInTheDocument()
    expect(t.getByText(/в классе меньше 6 человек, среднюю по нему не печатаем/)).toBeInTheDocument()
  })

  it('проверочных за период нет — строка, а не пустая таблица', () => {
    render(<ParentReportSheet report={{ ...report261, subjects: [{ ...physics261, assessments: [] }] }} />)
    expect(screen.getByText('Проверочных и контрольных за период не было.')).toBeInTheDocument()
    expect(screen.queryByTestId('report-assessment-row')).toBeNull()
  })
})

describe('§261 — лист 2: «Старание за период» вместо «Активности»', () => {
  it('дни с решением, каталог с проверкой, видео, награды одной строкой; подпись про регулярность', () => {
    render(<ParentReportSheet report={report261} />)
    const d = within(screen.getByTestId('parent-report-diligence'))
    expect(d.getByText('Старание за период')).toBeInTheDocument()
    expect(d.getByText('19')).toBeInTheDocument()
    expect(d.getByText('из 33 · серия сейчас 5')).toBeInTheDocument()
    expect(d.getByText('47')).toBeInTheDocument()
    expect(d.getByText('верно с проверкой ответа')).toBeInTheDocument()
    expect(d.getByText('3 ч 20 м')).toBeInTheDocument()
    expect(d.getByText('23')).toBeInTheDocument()
    expect(d.getByText('уровень 7 из 20')).toBeInTheDocument()
    expect(d.getByText('Старание — про регулярность, а не про знания. Знания — на листе 1.')).toBeInTheDocument()
  })

  it('без дублей: прежнего блока «Активность за период» и ячейки «Сдано вовремя» нет; «ДЗ вовремя» — один раз', () => {
    const { container } = render(<ParentReportSheet report={report261} />)
    expect(screen.queryByText('Активность за период')).toBeNull()
    expect(screen.queryByText('Сдано вовремя')).toBeNull()
    expect(screen.getAllByText('ДЗ вовремя')).toHaveLength(1)
    expect(screen.queryByText('Задачи каталога', { exact: true })).not.toBeNull()
    expect(container.textContent).not.toMatch(/решено самостоятельно/)
  })

  it('по-прежнему два листа, и новое стоит на своих листах', () => {
    render(<ParentReportSheet report={report261} />)
    const p1 = screen.getByTestId('parent-report-page-1')
    const p2 = screen.getByTestId('parent-report-page-2')
    expect(document.querySelectorAll('.report-sheet')).toHaveLength(2)
    expect(within(p1).getByTestId('report-forecast-physics')).toBeInTheDocument()
    expect(within(p1).getByTestId('report-assessments-physics')).toBeInTheDocument()
    expect(within(p2).getByTestId('parent-report-diligence')).toBeInTheDocument()
    expect(within(p1).queryByTestId('parent-report-diligence')).toBeNull()
  })

  it('и на новом листе нет ни внутренней заметки, ни слова «ИИ»', () => {
    const { container } = render(<ParentReportSheet report={report261} />)
    expect(container.innerHTML).not.toContain(SECRET)
    expect(container.textContent).not.toMatch(/\bИИ\b/)
  })
})
