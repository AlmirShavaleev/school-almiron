/**
 * §229. Проверка работы с вариантами: в шапке «Вариант N», ключ первой части —
 * его варианта, у выбранного номера — «Критерии» и «Решение» его варианта;
 * PDF вместо фото — страницы листами по вкладкам «Фото N · стр. K».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { examRow, fakeSupabase, PHOTOS, resultsAfter, ROSTER, scoresAfter, sheetsAfter, type Db } from './mockExamV3Fixture'

let db: Db
vi.mock('@/lib/supabase', async () => ({ supabase: fakeSupabase(() => db) }))
// PDF в jsdom не рисуется: документ — подделка с тремя страницами, страница — метка.
vi.mock('@/hooks/useSignedPdf', () => ({
  useSignedPdf: (_b: string, path: string | null) => (path ? { status: 'ready', doc: { numPages: 3 }, pages: 3 } : { status: 'idle', doc: null, pages: 0 }),
}))
vi.mock('@/components/pdf/PdfPageView', () => ({
  PdfPageView: ({ page }: { page: number }) => <div data-testid="pdf-page-view" data-page={page} />,
}))

import { MockExamReviewPage } from '@/pages/MockExamReviewPage'

function mount(student: string) {
  return render(
    <MemoryRouter initialEntries={[`/mock-exams/ex1/review/${student}`]}>
      <Routes><Route path="/mock-exams/:id/review/:studentId" element={<MockExamReviewPage />} /></Routes>
    </MemoryRouter>,
  )
}
const task = (n: number) => screen.getAllByTestId('mock-review-task').find(t => t.getAttribute('data-task-row') === String(n))!

const VARIANTS = [
  { id: 'v1', position: 1, label: null, condition_path: 'ex1/v1/condition/1_c1.pdf', solution_path: 'ex1/v1/solution/1_s1.pdf', criteria_path: null },
  { id: 'v2', position: 2, label: null, condition_path: 'ex1/v2/condition/1_c2.pdf', solution_path: 'ex1/v2/solution/1_s2.pdf', criteria_path: 'ex1/v2/criteria/1_k2.pdf' },
]

beforeEach(() => {
  db = {
    exam: examRow(-6 * 60),
    tables: {
      group_students: ROSTER, mock_exam_task_scores: scoresAfter(), mock_exam_sheets: sheetsAfter(), mock_exam_photos: PHOTOS, mock_exam_results: resultsAfter(),
      mock_exam_variants: VARIANTS,
      // Ключ варианта 2: №2 = «7» — у Гарипова (ответ 7) это верно; ключ пробника («8») здесь ни при чём.
      mock_exam_variant_keys: [{ variant_id: 'v1', answers: ['5', '8', '0,5'] }, { variant_id: 'v2', answers: ['5', '7', '0,5'] }],
      mock_exam_variant_students: [{ student_id: 'a', variant_id: 'v2' }, { student_id: 'b', variant_id: 'v1' }],
    },
    rpcCalls: [],
  }
})

describe('проверка с вариантами', () => {
  it('в шапке «Вариант 2»; ключ — варианта ученика; критерии и решение — его варианта', async () => {
    mount('a')
    expect(await screen.findByTestId('mock-review-variant')).toHaveTextContent('Вариант 2')
    expect(within(task(2)).getByTestId('mock-review-key')).toHaveTextContent('7')
    // Файлы варианта над номерами.
    expect(screen.getByTestId('mock-review-files')).toHaveTextContent('Вариант 2:')
    expect(screen.getByTestId('mock-review-file-criteria')).toBeInTheDocument()
    // Выбран №4 (вторая часть) — «Критерии» и «Решение» рядом с номером.
    expect(task(4)).toHaveAttribute('data-selected', 'true')
    const expand = screen.getByTestId('mock-review-expand')
    expect(within(expand).getByTestId('mock-review-criteria')).toHaveTextContent('Критерии — PDF')
    expect(within(expand).getByTestId('mock-review-solution')).toHaveTextContent('Решение — PDF')
  })

  it('ученик варианта 1 без критериев: ключ его варианта, «Критериев нет»', async () => {
    mount('b')
    expect(await screen.findByTestId('mock-review-variant')).toHaveTextContent('Вариант 1')
    expect(within(task(2)).getByTestId('mock-review-key')).toHaveTextContent('8')
    expect(screen.getByTestId('mock-review-file-criteria-none')).toBeInTheDocument()
  })

  it('один вариант — метки «Вариант» нет', async () => {
    db.tables.mock_exam_variants = [VARIANTS[0]]
    db.tables.mock_exam_variant_students = []
    mount('a')
    expect(await screen.findByTestId('mock-review-title')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-review-variant')).toBeNull()
  })

  it('PDF вместо фото — страницы листами: «Фото 1», «Фото 2 · стр. 1…3»', async () => {
    db.tables.mock_exam_photos = [PHOTOS[0], { id: 'ph9', student_id: 'a', storage_path: 'ex1/photos/a/3_scan.pdf', file_name: 'scan.pdf', position: 1, mime_type: 'application/pdf' }]
    mount('a')
    await screen.findByTestId('mock-review-title')
    await waitFor(() => expect(screen.getAllByTestId('mock-review-photo-tab').map(t => t.textContent)).toEqual(['Фото 1', 'Фото 2 · стр. 1', 'Фото 2 · стр. 2', 'Фото 2 · стр. 3']))
    fireEvent.click(screen.getAllByTestId('mock-review-photo-tab')[2])
    expect(screen.getByTestId('pdf-page-view')).toHaveAttribute('data-page', '2')
    expect(screen.queryByText('Не удалось показать изображение')).toBeNull()
  })
})
