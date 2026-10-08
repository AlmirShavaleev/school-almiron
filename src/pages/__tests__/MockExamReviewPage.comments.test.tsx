/**
 * §270. Комментарий ученику к номерам второй части на экране проверки:
 * поле в раскрытом номере; «Принять» / «Принять все предложения ИИ» кладут
 * комментарий ИИ только в пустое поле; «Сохранить» пишет баллы, затем только
 * изменённые комментарии (`save_mock_exam_task_comments`); комментарий к номеру
 * без балла — ошибка, текст не пропадает.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { examRow, fakeSupabase, PHOTOS, resultsAfter, ROSTER, scoresAfter, sheetsAfter, type Db } from './mockExamV3Fixture'

let db: Db
vi.mock('@/lib/supabase', async () => ({ supabase: fakeSupabase(() => db) }))

import { MockExamReviewPage } from '@/pages/MockExamReviewPage'

function mount(student: string) {
  return render(
    <MemoryRouter initialEntries={[`/mock-exams/ex1/review/${student}`]}>
      <Routes>
        <Route path="/mock-exams/:id/review/:studentId" element={<MockExamReviewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}
const task = (n: number) => screen.getAllByTestId('mock-review-task').find(t => t.getAttribute('data-task-row') === String(n))!
const pt = (n: number, v: number) => within(task(n)).getAllByTestId('mock-review-pt')[v]
const comment = () => screen.getByTestId('mock-review-comment') as HTMLTextAreaElement
const sug = (student: string, task_number: number, points: number, max_points: number, extra: Record<string, unknown> = {}) =>
  ({ student_id: student, task_number, points, max_points, confidence: 'high', comment: null, regions: [], created_at: null, ...extra })

// Шаблон фикстуры: 5 номеров, 1–3 — первая часть, №4 из 2, №5 из 3.
// a — №4 и №5 пусты; b — всё оценено, у №4 и №5 уже есть комментарии.
function scores() {
  return scoresAfter().map(r => (r.student_id === 'b' && r.task_number === 4 ? { ...r, comment: 'Старый комментарий' }
    : r.student_id === 'b' && r.task_number === 5 ? { ...r, comment: 'Не трогать' } : r))
}

beforeEach(() => {
  db = {
    exam: examRow(-6 * 60),
    tables: {
      group_students: ROSTER, mock_exam_task_scores: scores(), mock_exam_sheets: sheetsAfter(), mock_exam_photos: PHOTOS, mock_exam_results: resultsAfter(),
      mock_exam_ai_suggestions: [
        sug('a', 4, 1, 2, { comment: 'Нет обоснования отбора корней' }),
        sug('a', 5, 2, 3, { comment: 'Ошибка в знаке' }),
      ],
      mock_exam_ai_runs: [{ student_id: 'a', status: 'done', last_error: null, note: null, requested_at: new Date().toISOString(), started_at: null, finished_at: new Date().toISOString() }],
    },
    rpcCalls: [],
  }
})

const calls = (fn: string) => db.rpcCalls.filter(c => c.fn === fn)

describe('комментарий ученику на экране проверки', () => {
  it('поле — только у номеров второй части; сохранённый комментарий подставлен', async () => {
    mount('b')
    await screen.findByTestId('mock-review-title')
    fireEvent.click(task(2))
    expect(screen.queryByTestId('mock-review-comment')).toBeNull()
    fireEvent.click(task(4))
    expect(comment().value).toBe('Старый комментарий')
    expect(comment()).toHaveAttribute('maxLength', '2000')
    expect(screen.getByTestId('mock-review-comment-hint')).toHaveTextContent('после «Уведомить»')
    expect(screen.getByTestId('mock-review-save')).toBeDisabled()
  })

  it('«Принять» кладёт комментарий ИИ в пустое поле, но не поверх текста преподавателя', async () => {
    mount('a')
    await screen.findByTestId('mock-review-ai-line')
    expect(comment().value).toBe('')
    fireEvent.click(screen.getByTestId('mock-review-ai-accept'))
    expect(pt(4, 1)).toHaveAttribute('aria-pressed', 'true')
    expect(comment().value).toBe('Нет обоснования отбора корней')
    // №5: преподаватель написал своё — «Принять» ставит балл, текст не меняет.
    fireEvent.click(task(5))
    fireEvent.change(comment(), { target: { value: 'Мой текст' } })
    fireEvent.click(screen.getByTestId('mock-review-ai-accept'))
    expect(pt(5, 2)).toHaveAttribute('aria-pressed', 'true')
    expect(comment().value).toBe('Мой текст')
  })

  it('«Принять все» заполняет пустые поля и не трогает написанное', async () => {
    mount('a')
    await screen.findByTestId('mock-review-ai-line')
    fireEvent.click(task(5))
    fireEvent.change(comment(), { target: { value: 'Мой текст' } })
    fireEvent.click(screen.getByTestId('mock-review-ai-accept-all'))
    expect(comment().value).toBe('Мой текст')
    fireEvent.click(task(4))
    expect(comment().value).toBe('Нет обоснования отбора корней')
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-save')) })
    await waitFor(() => expect(calls('save_mock_exam_task_comments')).toHaveLength(1))
    // Сначала баллы, потом комментарии.
    expect(db.rpcCalls.findIndex(c => c.fn === 'save_mock_exam_grid')).toBeLessThan(db.rpcCalls.findIndex(c => c.fn === 'save_mock_exam_task_comments'))
    expect(calls('save_mock_exam_task_comments')[0].args).toEqual({
      p_mock_exam_id: 'ex1', p_student_id: 'a', p_comments: { 4: 'Нет обоснования отбора корней', 5: 'Мой текст' },
    })
  })

  it('«Сохранить» шлёт только изменённые комментарии; очищенный — null', async () => {
    mount('b')
    await screen.findByTestId('mock-review-title')
    fireEvent.click(task(4))
    fireEvent.change(comment(), { target: { value: '  Новый комментарий  ' } })
    // Изменение комментария — тоже несохранённое.
    expect(screen.getByTestId('mock-review-save')).not.toBeDisabled()
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-save')) })
    await waitFor(() => expect(calls('save_mock_exam_task_comments')).toHaveLength(1))
    expect(calls('save_mock_exam_grid')[0].args.p_rows).toEqual([{ student_id: 'b', points: [1, 1, 1, 2, 3] }])
    expect(calls('save_mock_exam_task_comments')[0].args.p_comments).toEqual({ 4: 'Новый комментарий' })

    db.rpcCalls = []
    fireEvent.click(task(5))
    fireEvent.change(comment(), { target: { value: '   ' } })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-save')) })
    await waitFor(() => expect(calls('save_mock_exam_task_comments')).toHaveLength(1))
    expect(calls('save_mock_exam_task_comments')[0].args.p_comments).toEqual({ 4: 'Новый комментарий', 5: null })
  })

  it('без изменений комментариев функцию комментариев не зовём', async () => {
    mount('b')
    await screen.findByTestId('mock-review-title')
    fireEvent.click(pt(4, 1))
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-save')) })
    await waitFor(() => expect(calls('save_mock_exam_grid')).toHaveLength(1))
    expect(calls('save_mock_exam_task_comments')).toHaveLength(0)
  })

  it('комментарий к номеру без балла — ошибка, ничего не пишем, текст остаётся', async () => {
    mount('a')
    await screen.findByTestId('mock-review-title')
    expect(task(4)).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('mock-review-comment-hint')).toHaveTextContent('Сначала поставьте балл')
    fireEvent.change(comment(), { target: { value: 'Почти верно' } })
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-save')) })
    expect(screen.getByTestId('mock-review-status')).toHaveTextContent('задание №4: сначала поставьте балл')
    expect(calls('save_mock_exam_grid')).toHaveLength(0)
    expect(calls('save_mock_exam_task_comments')).toHaveLength(0)
    expect(comment().value).toBe('Почти верно')
    // Поставили балл — сохраняется.
    fireEvent.click(pt(4, 1))
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-save')) })
    await waitFor(() => expect(calls('save_mock_exam_task_comments')).toHaveLength(1))
    expect(calls('save_mock_exam_task_comments')[0].args.p_comments).toEqual({ 4: 'Почти верно' })
  })
})
