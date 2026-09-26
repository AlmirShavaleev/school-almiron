/**
 * §221. Таблица пробника §218 у онлайн-пробника: первая часть проверена по
 * ключу в базе (`grade_mock_exam_part1`) ДО чтения баллов, клетки «авто»
 * видны, исправленная клетка — как поставленная вручную. Таблица и её
 * сохранение — прежние (§218/§219), сюда только приходят данные бланка.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const TEMPLATE = { id: 't1', title: 'Мини', subject: 'math', exam_type: 'ege', year: 2027, max_points: [1, 1, 2, 3], part1_last: 2, score_scale: null }
const ROSTER = [
  { id: 's-a', pid: 'p-a', name: 'Абрамова Дарья' },
  { id: 's-b', pid: 'p-b', name: 'Белов Артём' },
  { id: 's-c', pid: 'p-c', name: 'Сафин Амир' },
]
const hour = 3600_000
const START = new Date(Date.now() - 6 * hour).toISOString()

let calls: string[]
let stored: { student_id: string; task_number: number; points: number; auto_points: number | null }[]

function thenable<T>(value: T) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(value),
    then: (res: (v: T) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(value).then(res, rej),
  }
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'mock_exams') {
        return thenable({
          data: {
            id: 'ex1', title: 'Пробник №3', date: START, subject: 'math', exam_type: 'ege', group_id: 'g1', template_id: 't1',
            groups: { name: '11А' }, mock_exam_templates: TEMPLATE,
            starts_at: START, duration_minutes: 240, photo_grace_minutes: 15,
          },
          error: null,
        })
      }
      if (table === 'group_students') {
        return thenable({ data: ROSTER.map(r => ({ student_id: r.id, students: { id: r.id, profile_id: r.pid, profiles: { full_name: r.name } } })), error: null })
      }
      if (table === 'mock_exam_task_scores') { calls.push('read-scores'); return thenable({ data: stored, error: null }) }
      if (table === 'mock_exam_results') return thenable({ data: [], error: null })
      if (table === 'mock_exam_sheets') return thenable({ data: [{ student_id: 's-a', submitted_at: new Date(Date.now() - 5 * hour).toISOString() }, { student_id: 's-b', submitted_at: null }], error: null })
      if (table === 'mock_exam_photos') return thenable({ data: [{ id: 'ph1', student_id: 's-a', storage_path: 'ex1/photos/s-a/1_p.webp', file_name: 'p.webp', position: 0 }], error: null })
      throw new Error(`неожиданная таблица ${table}`)
    },
    rpc: (fn: string) => {
      calls.push(fn)
      if (fn === 'grade_mock_exam_part1') return Promise.resolve({ data: { graded_students: 2, changed_cells: 4 }, error: null })
      if (fn === 'save_mock_exam_grid') return Promise.resolve({ data: { rows: [] }, error: null })
      // §224: монитора в базе ещё нет (ветка раньше PENDING_224) — экран
      // показывает то, что видно из бланков и фото §221.
      if (fn === 'mock_exam_live') return Promise.resolve({ data: null, error: { message: 'function mock_exam_live does not exist' } })
      throw new Error(fn)
    },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://x' }, error: null }) }) },
  },
}))

import { MockExamGridPage } from '@/pages/MockExamGridPage'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/mock-exams/ex1']}>
      <Routes><Route path="/mock-exams/:id" element={<MockExamGridPage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  calls = []
  stored = [
    // Абрамова: обе клетки первой части — по ключу; №3 поставлен вручную.
    { student_id: 's-a', task_number: 1, points: 1, auto_points: 1 },
    { student_id: 's-a', task_number: 2, points: 0, auto_points: 0 },
    { student_id: 's-a', task_number: 3, points: 2, auto_points: null },
    // Белов: №2 ключ дал 0, преподаватель исправил на 1 — клетка ручная.
    { student_id: 's-b', task_number: 1, points: 1, auto_points: 1 },
    { student_id: 's-b', task_number: 2, points: 1, auto_points: 0 },
  ]
})

describe('онлайн-пробник в таблице §218', () => {
  it('проверка по ключу — в базе и до чтения баллов', async () => {
    mount()
    await screen.findByTestId('mock-exam-grid-page')
    expect(calls.indexOf('grade_mock_exam_part1')).toBeGreaterThanOrEqual(0)
    expect(calls.indexOf('grade_mock_exam_part1')).toBeLessThan(calls.indexOf('read-scores'))
    expect(screen.getByTestId('mock-grid-grade-note')).toHaveTextContent('обновлено клеток — 4')
  })

  it('«авто» — где points = auto_points; исправленная и ручная — без отметки', async () => {
    mount()
    const rows = await screen.findAllByTestId('mock-grid-row')
    const cells = (r: HTMLElement) => [...r.querySelectorAll('td')].slice(1, 5)
    const autoOf = (r: HTMLElement) => cells(r).map(td => td.hasAttribute('data-auto'))
    expect(autoOf(rows[0])).toEqual([true, true, false, false])
    expect(autoOf(rows[1])).toEqual([true, false, false, false])
    expect(autoOf(rows[2])).toEqual([false, false, false, false])
    // Заголовок первой части — «авто», второй — максимум.
    expect(screen.getAllByText('авто')).toHaveLength(2)
  })

  it('правка авто-клетки снимает отметку сразу — ещё до сохранения', async () => {
    mount()
    const rows = await screen.findAllByTestId('mock-grid-row')
    const input = within(rows[0]).getByLabelText('Абрамова Дарья, задание 2')
    fireEvent.change(input, { target: { value: '1' } })
    await waitFor(() => expect(input.closest('td')).not.toHaveAttribute('data-auto'))
  })

  it('работы учеников (§224, без mock_exam_live): не заходил → открывал и не сдал → сдал; фото — ссылками; блок под таблицей после конца', async () => {
    mount()
    const works = await screen.findByTestId('mock-grid-works')
    expect(works).toHaveAttribute('data-phase', 'ended')
    expect(screen.getByTestId('mock-live-headline')).toHaveTextContent(/^Закончился · /)
    const rows = within(works).getAllByTestId('mock-grid-work-row')
    expect(rows[0]).toHaveTextContent(/Сафин Амир.*Не заходил/)
    expect(rows[1]).toHaveTextContent(/Белов Артём.*Открывал · не сдал.*фото нет/)
    expect(rows[2]).toHaveTextContent(/Абрамова Дарья.*Сдал в \d\d:\d\d.*фото 1:.*стр\. 1/)
    expect(screen.getByTestId('mock-live-counts')).toHaveTextContent('В группе 3 · сдали 1 · открывали, не нажали «Сдать» 1 · не заходили 1')
    // После конца главное — проверка: блок работ под таблицей.
    const grid = screen.getByTestId('mock-grid')
    expect(grid.compareDocumentPosition(works) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
