import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TeacherDashboard } from '@/pages/teacher/TeacherDashboard'
import { EMPTY_HOME, type OverdueRow, type TeacherHomeData } from '@/lib/teacherHome'
import type { QueueRow } from '@/lib/homeworkQueue'

/**
 * §233. Главная преподавателя v2 (экран 03). Прежний тест проверял плитки и
 * «Ждут проверки: N работ» старой главной — этого экрана больше нет. Замысел
 * «очередь — по живому контуру topic_homework» сохранён: работы на проверке
 * приходят строками очереди (`QueueRow`), а не из легаси.
 */

const hook = vi.fn()
vi.mock('@/hooks/useTeacherHome', () => ({ useTeacherHome: () => hook() }))

const q = (id: string, hw: string, submitted: string, due: string | null): QueueRow => ({
  attempt: { id, homework_id: hw, student_id: `st-${id}`, attempt_number: 1, status: 'submitted', submitted_at: submitted, created_at: submitted, updated_at: submitted } as QueueRow['attempt'],
  history: [], homeworkId: hw, homeworkTitle: 'ДЗ', gradeScale: 'five', dueAt: due,
  topicId: `t-${hw}`, topicTitle: hw === 'h13' ? 'Отбор корней' : 'Векторы', courseId: 'c1', courseTitle: 'Математика',
})

const od = (o: Partial<OverdueRow>): OverdueRow => ({
  homework_id: 'h13', topic_id: 't-h13', course_id: 'c1', group_id: 'g1', group_name: '11А · Профиль', title: 'Отбор корней',
  student_id: 's1', student_name: 'Сафин Данияр', due_date: '2026-09-24', telegram: 'ok', reminded_at: null, ...o,
})

const overdue: OverdueRow[] = [
  od({ student_id: 's1', student_name: 'Сафин Данияр' }),
  od({ student_id: 's2', student_name: 'Ахмадуллин Рустем' }),
  od({ student_id: 's3', student_name: 'Зиннатуллин Артур', due_date: '2026-09-25' }),
  od({ student_id: 's4', student_name: 'Никитина Вера', telegram: 'none', due_date: '2026-09-25' }),
]

const full: TeacherHomeData = {
  ...EMPTY_HOME,
  today: '2026-09-26',
  now: '2026-09-26T09:00:00Z',
  groups: [{ course_id: 'c1', course_title: 'Математика', group_id: 'g1', name: '11А · Профиль' }],
  mock_pending: [{ mock_exam_id: 'm3', title: 'Пробник №3', group_name: '11А · Профиль', works: 2, oldest_student_id: 'st9', oldest_at: '2026-09-23T10:00:00Z' }],
  overdue,
  series: [
    { student_id: 's7', student_name: 'Валиев Карим', course_id: 'c1', group_name: '11А · Профиль', hw: [78, 84, 80, 86, 77, 55, 50, 57], mocks: [] },
    { student_id: 's8', student_name: 'Ровный Ученик', course_id: 'c1', group_name: '11А · Профиль', hw: [80, 80, 80, 80, 80, 80, 80, 80], mocks: [] },
  ],
  upcoming: [{ kind: 'mock', id: 'm4', topic_id: null, course_id: 'c1', group_name: '11А', title: 'Пробник №4', day: '2026-10-03', time: '10:00' }],
}

const pending = [
  q('a1', 'h13', '2026-09-20T10:00:00Z', '2026-09-19'),
  q('a2', 'h13', '2026-09-18T10:00:00Z', '2026-09-19'),
  q('a3', 'h2', '2026-09-24T10:00:00Z', null),
]

const remind = vi.fn()
function state(o: Partial<ReturnType<typeof base>> = {}) { return { ...base(), ...o } }
function base() {
  return { pending: [] as QueueRow[], home: { ...EMPTY_HOME, today: '2026-09-26' } as TeacherHomeData, loading: false, error: null as string | null, reload: vi.fn(), remind }
}

const renderPage = () => render(<MemoryRouter><TeacherDashboard /></MemoryRouter>)

describe('Главная преподавателя v2', () => {
  beforeEach(() => {
    remind.mockReset()
    hook.mockReturnValue(state({ pending, home: full }))
  })

  it('баннер: дата и фраза из чисел блоков — работы ДЗ и пробника, просрочка по сроку сдачи, должники, просевшие', () => {
    renderPage()
    expect(screen.getByText('Суббота, 26 сентября')).toBeInTheDocument()
    expect(screen.getByTestId('teacher-home-phrase')).toHaveTextContent(
      '5 работ ждут проверки, 1 из них просрочена. Четверо не сдали ДЗ «Отбор корней». Один ученик просел на последних работах.',
    )
  })

  it('одна главная кнопка — в проверку самой давней работы (здесь — ДЗ, сдано 18-го)', () => {
    renderPage()
    const start = screen.getByTestId('teacher-home-start')
    expect(start).toHaveTextContent('Начать проверку — с самых давних →')
    expect(start).toHaveAttribute('href', '/homework-queue?attempt=a2')
  })

  it('«На проверке»: строка на задание с группой, числом и просрочкой; ведёт в очередь задания', () => {
    renderPage()
    const block = screen.getByTestId('home-review')
    expect(within(block).getByText('5 работ')).toBeInTheDocument()
    const rows = within(block).getAllByTestId('home-review-row')
    expect(rows.map(r => r.getAttribute('href'))).toEqual([
      '/homework-queue?topic=t-h13', '/mock-exams/m3?tab=works', '/homework-queue?topic=t-h2',
    ])
    expect(rows[0]).toHaveTextContent('Отбор корней')
    expect(rows[0]).toHaveTextContent('11А · Профиль')
    expect(rows[0]).toHaveTextContent('1 просрочена')
    expect(rows[1]).toHaveTextContent('Пробник №3')
  })

  it('«Не сдали к сроку»: имя · ДЗ · когда; строка ведёт к ученику; кнопка и честная оговорка про Telegram', () => {
    renderPage()
    const rows = screen.getAllByTestId('home-overdue-row')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('Сафин Данияр · Отбор корней')
    expect(rows[0]).toHaveTextContent('срок прошёл 2 дня назад')
    expect(rows[2]).toHaveTextContent('вчера')
    expect(rows[0]).toHaveAttribute('href', '/students/s1')
    expect(screen.getByTestId('home-remind')).toHaveTextContent('Напомнить всем троим')
    expect(screen.getByTestId('home-remind-note')).toHaveTextContent('3 из 4 — нет Telegram: Никитина В.')
  })

  it('«Напомнить всем» зовёт отправку по ученикам с экрана — каждый один раз', async () => {
    let done: () => void = () => {}
    remind.mockReturnValue(new Promise<void>(r => { done = r }))
    renderPage()
    fireEvent.click(screen.getByTestId('home-remind'))
    expect(remind).toHaveBeenCalledWith(['s1', 's2', 's3', 's4'])
    expect(screen.getByTestId('home-remind')).toHaveTextContent('Отправляем…')
    expect(screen.getByTestId('home-remind')).toBeDisabled()
    done()
    await waitFor(() => expect(screen.getByTestId('home-remind')).not.toBeDisabled())
  })

  it('после отправки: «Напомнили в 14:05» вместо кнопки, оговорка про Telegram остаётся', () => {
    const at = '2026-09-26T11:05:00.000Z' // 14:05 МСК
    hook.mockReturnValue(state({
      pending,
      home: { ...full, overdue: overdue.map(r => (r.telegram === 'ok' ? { ...r, reminded_at: at } : r)) },
    }))
    renderPage()
    expect(screen.queryByTestId('home-remind')).not.toBeInTheDocument()
    expect(screen.getByTestId('home-reminded')).toHaveTextContent('Напомнили в 14:05')
    expect(screen.getByTestId('home-remind-note')).toHaveTextContent('3 из 4 — нет Telegram: Никитина В.')
  })

  it('отказ отправки показывается словами', async () => {
    remind.mockRejectedValue(new Error('Нет доступа к ученику'))
    renderPage()
    fireEvent.click(screen.getByTestId('home-remind'))
    expect(await screen.findByText('Нет доступа к ученику')).toBeInTheDocument()
  })

  it('«Просели»: только тот, кто просел; подпись и 8 столбиков, 3 последних — красные', () => {
    renderPage()
    const rows = screen.getAllByTestId('home-drop-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Валиев Карим')
    expect(rows[0]).toHaveTextContent('было 81 % по 5 работам, стало 54 % по 3 последним')
    expect(rows[0]).toHaveAttribute('href', '/students/s7')
    const bars = rows[0].querySelectorAll('[data-recent]')
    expect(Array.from(bars).map(b => b.getAttribute('data-recent'))).toEqual(['false', 'false', 'false', 'false', 'false', 'true', 'true', 'true'])
  })

  it('«Ближайшее»: день недели, дата, пробник со временем и группой', () => {
    renderPage()
    const row = screen.getByTestId('home-upcoming-row')
    expect(row).toHaveTextContent('сб, 3 октября')
    expect(row).toHaveTextContent('Пробник №4 в 10:00 · 11А')
    expect(row).toHaveAttribute('href', '/mock-exams/m4')
  })

  it('пусто: спокойная фраза, ни кнопки, ни пустых блоков', () => {
    hook.mockReturnValue(state())
    renderPage()
    expect(screen.getByTestId('teacher-home-phrase')).toHaveTextContent('Всё проверено. Никто не просрочил.')
    expect(screen.queryByTestId('teacher-home-start')).not.toBeInTheDocument()
    for (const id of ['home-review', 'home-overdue', 'home-drop', 'home-upcoming']) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument()
    }
  })

  it('плиток со статистикой старой главной больше нет', () => {
    renderPage()
    expect(screen.queryByText('Тестов в банке')).not.toBeInTheDocument()
    expect(screen.queryByText('Мои курсы')).not.toBeInTheDocument()
  })
})
