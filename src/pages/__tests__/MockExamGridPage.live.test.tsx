/**
 * §224. Монитор идущего пробника на странице таблицы: над таблицей, вывод
 * словами, счётчики с числом группы, проблемные — меткой, порядок
 * «не заходили → пишут → сдали». Онлайн приходит из `mock_exam_live` (база),
 * экран его не вычисляет.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const TEMPLATE = { id: 't1', title: 'Мини', subject: 'math', exam_type: 'ege', year: 2027, max_points: [1, 1, 2, 3], part1_last: 2, score_scale: null }
const ROSTER = [
  { id: 's-a', pid: 'p-a', name: 'Абрамова Дарья' },
  { id: 's-b', pid: 'p-b', name: 'Белов Артём' },
  { id: 's-c', pid: 'p-c', name: 'Сафин Амир' },
  { id: 's-d', pid: 'p-d', name: 'Ёлкина Мария' },
]
const min = 60_000
const START = new Date(Date.now() - 47 * min).toISOString()
const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * min).toISOString()

function thenable<T>(value: T) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(value),
    then: (res: (v: T) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(value).then(res, rej),
  }
  return chain
}

const LIVE = {
  id: 'ex1', title: 'Пробник №3', group_id: 'g1',
  starts_at: START,
  ends_at: new Date(new Date(START).getTime() + 240 * min).toISOString(),
  photos_until: new Date(new Date(START).getTime() + 255 * min).toISOString(),
  server_now: new Date().toISOString(),
  part1_last: 2,
  students: [
    { student_id: 's-a', name: 'Абрамова Дарья', has_sheet: true, opened_at: iso(-40), last_seen_at: iso(-0.5), online: true, answered: 1, submitted_at: null, photos: 0 },
    { student_id: 's-b', name: 'Белов Артём', has_sheet: true, opened_at: iso(-45), last_seen_at: iso(-10), online: false, answered: 2, submitted_at: iso(-10), photos: 2 },
    { student_id: 's-c', name: 'Сафин Амир', has_sheet: false, opened_at: null, last_seen_at: null, online: false, answered: 0, submitted_at: null, photos: 0 },
    { student_id: 's-d', name: 'Ёлкина Мария', has_sheet: true, opened_at: iso(-44), last_seen_at: iso(-20), online: false, answered: 0, submitted_at: null, photos: 0 },
  ],
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
      if (table === 'mock_exam_task_scores') return thenable({ data: [], error: null })
      if (table === 'mock_exam_results') return thenable({ data: [], error: null })
      if (table === 'mock_exam_sheets') return thenable({ data: [], error: null })
      if (table === 'mock_exam_photos') return thenable({ data: [], error: null })
      throw new Error(`неожиданная таблица ${table}`)
    },
    rpc: (fn: string) => {
      if (fn === 'grade_mock_exam_part1') return Promise.resolve({ data: { graded_students: 0, changed_cells: 0 }, error: null })
      if (fn === 'mock_exam_live') return Promise.resolve({ data: LIVE, error: null })
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

describe('§224 монитор идущего пробника', () => {
  it('над таблицей: вывод, счётчики, ученики по состояниям; проблемный — меткой', async () => {
    mount()
    const works = await screen.findByTestId('mock-grid-works')
    expect(works).toHaveAttribute('data-phase', 'running')
    // Сначала вывод: блок стоит раньше таблицы.
    const grid = screen.getByTestId('mock-grid')
    expect(works.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('mock-live-headline')).toHaveTextContent(/^Идёт · осталось 3 ч 13 мин · до \d\d:\d\d$/)

    const counts = await screen.findByText(/пишут сейчас/)
    expect(counts).toHaveTextContent('В группе 4 · пишут сейчас 1 · сдали 1 · открывали, сейчас не на сайте 1 · не заходили 1')

    const rows = within(works).getAllByTestId('mock-grid-work-row')
    expect(rows.map(r => r.getAttribute('data-kind'))).toEqual(['absent', 'away', 'online', 'submitted'])
    expect(rows[0]).toHaveTextContent(/Сафин Амир.*Не заходил/)
    expect(rows[1]).toHaveTextContent(/Ёлкина Мария.*Был в \d\d:\d\d.*бланк 0 из 2/)
    expect(rows[2]).toHaveTextContent(/Абрамова Дарья.*Пишет · онлайн.*бланк 1 из 2/)
    expect(rows[3]).toHaveTextContent(/Белов Артём.*Сдал в \d\d:\d\d.*бланк 2 из 2.*фото 2/)
    // «Не заходил» после начала — видно формой: метка с иконкой, а не только словом.
    expect(within(rows[0]).getByTestId('mock-live-status').querySelector('svg')).not.toBeNull()
    expect(within(rows[2]).getByTestId('mock-live-status').querySelector('svg')).toBeNull()
  })
})
