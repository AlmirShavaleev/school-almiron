import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ParentReportSheet } from '@/components/report/ParentReportSheet'
import type { ProgressReport } from '@/lib/parentReport'

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

  it('прогноза балла на экзамене нет ни в каком виде', () => {
    const { container } = render(<ParentReportSheet report={report} />)
    expect(container.textContent).not.toMatch(/прогноз/i)
    expect(container.textContent).not.toMatch(/ожидаем/i)
  })

  it('средний балл напечатан вместе с числом работ', () => {
    render(<ParentReportSheet report={report} />)
    const physics = screen.getByTestId('report-subject-physics')
    expect(within(physics).getByText('62 %')).toBeInTheDocument()
    expect(within(physics).getByText('по 7 проверенным работам')).toBeInTheDocument()
  })

  it('в группе из четырёх среднее по группе — прочерк с пояснением', () => {
    render(<ParentReportSheet report={report} />)
    const math = screen.getByTestId('report-subject-math')
    expect(within(math).getByText('в группе 4 человека, среднее не печатаем')).toBeInTheDocument()
  })

  it('в группе из девяти среднее по группе — число', () => {
    render(<ParentReportSheet report={report} />)
    const physics = screen.getByTestId('report-subject-physics')
    expect(within(physics).getByText('58 %')).toBeInTheDocument()
    expect(within(physics).getByText('9 человек в группе')).toBeInTheDocument()
  })

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
    expect(screen.getByText(/у работ периода не проставлен срок/)).toBeInTheDocument()
  })

  it('имён других учеников на листе нет — только агрегаты', () => {
    const { container } = render(<ParentReportSheet report={report} />)
    expect(container.textContent).toContain('Нурмухаметова Алина')
    // Ни одной другой фамилии в отчёте быть неоткуда: база отдаёт только
    // среднее и размер группы.
    expect(container.textContent).not.toMatch(/Иванов|Петров/)
  })
})
