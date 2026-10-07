/**
 * §222b. Экран проверки работы: предложения ИИ по второй части — «ИИ: 1 из 2»
 * с уверенностью и комментарием, «Принять» (как ручной ввод, в базу — обычным
 * «Сохранить»), «Принять все предложения ИИ» (только пустые клетки, ручные
 * баллы не трогает), рамки на фото выбранного номера, «Проверить ИИ» и статус.
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
const sug = (student: string, task_number: number, points: number, max_points: number, extra: Record<string, unknown> = {}) =>
  ({ student_id: student, task_number, points, max_points, confidence: 'high', comment: null, regions: [], created_at: null, ...extra })

// Шаблон фикстуры: 5 номеров, 1–3 — первая часть, №4 из 2, №5 из 3.
// a — первая часть по ключу, №4 и №5 пусты; b — всё оценено вручную (№5 = 3).
function suggestions() {
  return [
    sug('a', 4, 1, 2, { confidence: 'medium', comment: 'Нет обоснования отбора корней', regions: [{ photo_id: 'ph2', page: 1, x: 0.1, y: 0.25, w: 0.5, h: 0.2 }] }),
    sug('a', 5, 3, 3),
    sug('b', 5, 1, 3, { comment: 'Ошибка в вычислении' }),
  ]
}

beforeEach(() => {
  db = {
    exam: examRow(-6 * 60),
    tables: {
      group_students: ROSTER, mock_exam_task_scores: scoresAfter(), mock_exam_sheets: sheetsAfter(), mock_exam_photos: PHOTOS, mock_exam_results: resultsAfter(),
      mock_exam_ai_suggestions: suggestions(),
      mock_exam_ai_runs: [{ student_id: 'a', status: 'done', last_error: null, note: null, requested_at: new Date().toISOString(), started_at: null, finished_at: new Date().toISOString() }],
    },
    rpcCalls: [],
  }
})

const saved = () => db.rpcCalls.find(c => c.fn === 'save_mock_exam_grid')?.args.p_rows

describe('предложения ИИ на экране проверки', () => {
  it('у выбранного номера — «ИИ: 1 из 2», уверенность, комментарий; подсказки в строках; статус', async () => {
    mount('a')
    expect(await screen.findByTestId('mock-review-ai-line')).toHaveTextContent('ИИ: 1 из 2')
    expect(screen.getByTestId('mock-review-ai-confidence')).toHaveTextContent('есть сомнения')
    expect(screen.getByTestId('mock-review-ai-comment')).toHaveTextContent('Нет обоснования отбора корней')
    expect(within(task(4)).getByTestId('mock-review-ai-hint')).toHaveTextContent('ИИ 1')
    expect(within(task(5)).getByTestId('mock-review-ai-hint')).toHaveTextContent('ИИ 3')
    // Первая часть — без подсказок ИИ.
    expect(within(task(2)).queryByTestId('mock-review-ai-hint')).toBeNull()
    expect(screen.getByTestId('mock-review-ai-status')).toHaveTextContent('ИИ предложил баллы: 2')
    expect(screen.getByTestId('mock-review-ai-run')).toHaveTextContent('Проверить ИИ заново')
    // Клетка не тронута, пока не нажали «Принять».
    expect(task(4)).toHaveAttribute('data-mark', 'unk')
  })

  it('«Принять» ставит балл как ручной ввод; в базу — только «Сохранить»', async () => {
    mount('a')
    fireEvent.click(await screen.findByTestId('mock-review-ai-accept'))
    expect(pt(4, 1)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('mock-review-ai-accept')).toHaveTextContent('Принято')
    expect(screen.getByTestId('mock-review-ai-accept')).toBeDisabled()
    expect(saved()).toBeUndefined()
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-save')) })
    await waitFor(() => expect(saved()).toEqual([{ student_id: 'a', points: [1, 0, 1, 1, null] }]))
    // ИИ ученику ничего не шлёт: уведомление — только «Уведомить».
    expect(db.rpcCalls.some(c => c.fn === 'notify_mock_exam_results')).toBe(false)
  })

  it('«Принять все» — только пустые клетки второй части; поставленный вручную балл не трогает', async () => {
    mount('a')
    await screen.findByTestId('mock-review-ai-line')
    fireEvent.click(pt(4, 2)) // вручную 2, ИИ предлагал 1
    expect(screen.getByTestId('mock-review-ai-accept-all')).toHaveTextContent('Принять все предложения ИИ · 1')
    fireEvent.click(screen.getByTestId('mock-review-ai-accept-all'))
    expect(pt(4, 2)).toHaveAttribute('aria-pressed', 'true')
    expect(pt(5, 3)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('mock-review-status')).toHaveTextContent('Принято предложений ИИ: 1 (№5)')
    // Принимать больше нечего — кнопки нет.
    expect(screen.queryByTestId('mock-review-ai-accept-all')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-save')) })
    await waitFor(() => expect(saved()).toEqual([{ student_id: 'a', points: [1, 0, 1, 2, 3] }]))
  })

  it('у проверенной вручную работы «Принять все» нет; «Принять» предлагает замену явно', async () => {
    mount('b')
    await screen.findByTestId('mock-review-ai-status')
    expect(screen.queryByTestId('mock-review-ai-accept-all')).toBeNull()
    fireEvent.click(task(5))
    expect(screen.getByTestId('mock-review-ai-accept')).toHaveTextContent('Принять 1 вместо 3')
    expect(pt(5, 3)).toHaveAttribute('aria-pressed', 'true')
  })

  it('рамки выбранного номера — поверх фото; фото переключается на лист рамки', async () => {
    mount('a')
    await screen.findByTestId('mock-review-ai-line')
    const tabs = screen.getAllByTestId('mock-review-photo-tab')
    await waitFor(() => expect(tabs[1]).toHaveAttribute('aria-selected', 'true'))
    const box = screen.getByTestId('mock-review-ai-region')
    expect(box.style.left).toBe('10%')
    expect(box.style.top).toBe('25%')
    expect(box.style.width).toBe('50%')
    expect(box.style.height).toBe('20%')
    // У №5 рамок нет — и на фото их нет.
    fireEvent.click(task(5))
    expect(screen.queryByTestId('mock-review-ai-region')).toBeNull()
  })

  it('«Проверить ИИ» — заявка и функция по этому ученику; новые предложения появляются', async () => {
    db.tables.mock_exam_ai_suggestions = []
    db.tables.mock_exam_ai_runs = []
    db.onInvoke = () => { db.tables.mock_exam_ai_suggestions = [sug('a', 4, 2, 2)] }
    mount('a')
    expect(await screen.findByTestId('mock-review-ai-status')).toHaveTextContent('ИИ ещё не проверял')
    expect(screen.getByTestId('mock-review-ai')).toHaveTextContent('ИИ ещё не проверял эту работу')
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-ai-run')) })
    expect(db.rpcCalls.find(c => c.fn === 'mock_exam_ai_request_check')!.args).toEqual({ p_mock_exam_id: 'ex1', p_student_ids: ['a'] })
    expect(db.invokes).toEqual([{ name: 'check-mock-exam-ai', body: { mock_exam_id: 'ex1', student_ids: ['a'] } }])
    expect(await screen.findByTestId('mock-review-ai-line')).toHaveTextContent('ИИ: 2 из 2')
  })

  it('ошибка проверки — текстом из last_error; идёт — кнопка занята', async () => {
    db.tables.mock_exam_ai_suggestions = []
    db.tables.mock_exam_ai_runs = [{ student_id: 'a', status: 'error', last_error: 'Модель отказала: 502 upstream down', note: null, requested_at: new Date().toISOString(), started_at: null, finished_at: null }]
    const { unmount } = mount('a')
    expect(await screen.findByTestId('mock-review-ai-status')).toHaveTextContent('ИИ: ошибка — Модель отказала: 502 upstream down')
    unmount()
    db.tables.mock_exam_ai_runs = [{ student_id: 'a', status: 'running', last_error: null, note: null, requested_at: new Date().toISOString(), started_at: new Date().toISOString(), finished_at: null }]
    mount('a')
    await waitFor(() => expect(screen.getByTestId('mock-review-ai-status')).toHaveTextContent('ИИ проверяет вторую часть'))
    expect(screen.getByTestId('mock-review-ai-run')).toBeDisabled()
  })
})
