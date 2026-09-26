/**
 * §228. Проверка работы ученика по номерам: первая часть — ответ рядом с
 * ключом и балл ключа (исправимый), вторая — кнопки 0…максимум; клавиши;
 * сохранение строкой ученика целиком существующей `save_mock_exam_grid`;
 * «Сохранить и следующая» — к следующей непроверенной; «Уведомить» — только
 * когда все номера оценены и сохранены.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { examRow, fakeSupabase, PHOTOS, resultsAfter, ROSTER, scoresAfter, sheetsAfter, type Db } from './mockExamV3Fixture'

let db: Db
vi.mock('@/lib/supabase', async () => ({ supabase: fakeSupabase(() => db) }))

import { MockExamReviewPage } from '@/pages/MockExamReviewPage'

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}{l.search}</div> }
function mount(student: string) {
  return render(
    <MemoryRouter initialEntries={[`/mock-exams/ex1/review/${student}`]}>
      <Routes>
        <Route path="/mock-exams/:id/review/:studentId" element={<><MockExamReviewPage /><Where /></>} />
        <Route path="/mock-exams/:id" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}
const task = (n: number) => screen.getAllByTestId('mock-review-task').find(t => t.getAttribute('data-task-row') === String(n))!
const pt = (n: number, v: number) => within(task(n)).getAllByTestId('mock-review-pt')[v]

beforeEach(() => {
  db = {
    exam: examRow(-6 * 60),
    tables: { group_students: ROSTER, mock_exam_task_scores: scoresAfter(), mock_exam_sheets: sheetsAfter(), mock_exam_photos: PHOTOS, mock_exam_results: resultsAfter() },
    rpcCalls: [],
  }
})

describe('экран проверки', () => {
  it('шапка: «работа N из M», имя, сдал, фото; первая часть — ответ рядом с ключом и «авто»', async () => {
    mount('a')
    expect(await screen.findByTestId('mock-review-title')).toHaveTextContent('Гарипов Тимур — Пробник №4')
    // Работы, которые можно проверять: Белов, Гарипов, Каримова (Зайцев не писал).
    expect(screen.getByTestId('mock-review-back')).toHaveTextContent('Пробник №4 · работа 2 из 3')
    expect(screen.getByTestId('mock-review-meta')).toHaveTextContent('11А профиль · сдал')
    expect(screen.getByTestId('mock-review-meta')).toHaveTextContent('2 фото')
    expect(screen.getAllByTestId('mock-review-photo-tab').map(t => t.textContent)).toEqual(['Фото 1', 'Фото 2'])
    expect(within(task(2)).getByTestId('mock-review-answer')).toHaveTextContent('7')
    expect(within(task(2)).getByTestId('mock-review-key')).toHaveTextContent('8')
    expect(task(2)).toHaveAttribute('data-mark', 'bad')
    expect(task(2)).toHaveTextContent('авто')
    expect(task(4)).toHaveAttribute('data-mark', 'unk')
    // Первым выбран первый неоценённый номер второй части — раскрыт с местом под ИИ.
    expect(task(4)).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('mock-review-ai')).toHaveTextContent('Подсказка ИИ — позже (этап Б)')
    expect(screen.getByTestId('mock-review-missing')).toHaveTextContent('№4, №5 ещё не оценены')
    // Уведомить нельзя — оценено не всё.
    expect(screen.queryByTestId('mock-review-notify')).toBeNull()
  })

  it('кнопки и клавиши ставят баллы; сохранение — строкой ученика целиком; исправленная клетка ключа уходит как ручная', async () => {
    mount('a')
    await screen.findByTestId('mock-review-title')
    fireEvent.click(pt(4, 2))
    expect(pt(4, 2)).toHaveAttribute('aria-pressed', 'true')
    // ↓ — к №5, цифра «3» — балл выбранному; «7» больше максимума — не ставится.
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: '7' })
    expect(task(5)).toHaveAttribute('data-mark', 'unk')
    fireEvent.keyDown(window, { key: '3' })
    expect(task(5)).toHaveAttribute('data-mark', 'ok')
    // Опечатка в ключе: №2 исправлен на 1 — «авто» пропадает.
    fireEvent.click(pt(2, 1))
    expect(task(2)).not.toHaveTextContent('авто')
    expect(screen.getByTestId('mock-review-primary')).toHaveTextContent('8')
    expect(screen.getByTestId('mock-review-missing')).toHaveTextContent('все номера оценены')
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-save')) })
    await waitFor(() => expect(db.rpcCalls.some(c => c.fn === 'save_mock_exam_grid')).toBe(true))
    expect(db.rpcCalls.find(c => c.fn === 'save_mock_exam_grid')!.args).toEqual({
      p_mock_exam_id: 'ex1', p_rows: [{ student_id: 'a', points: [1, 1, 1, 2, 3] }],
    })
    // При сохранении ученик ничего не получает (§219).
    expect(db.rpcCalls.some(c => c.fn === 'notify_mock_exam_results')).toBe(false)
  })

  it('«Сохранить и следующая» — к следующей НЕпроверенной по списку «Работ»', async () => {
    mount('a')
    await screen.findByTestId('mock-review-title')
    fireEvent.click(pt(4, 1))
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-save-next')) })
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/mock-exams/ex1/review/d'))
    expect(db.rpcCalls.find(c => c.fn === 'save_mock_exam_grid')!.args.p_rows).toEqual([{ student_id: 'a', points: [1, 0, 1, 1, null] }])
  })

  it('несохранённые баллы — «Следующая работа» спрашивает, а не теряет молча', async () => {
    mount('a')
    await screen.findByTestId('mock-review-title')
    fireEvent.click(pt(4, 1))
    fireEvent.click(screen.getByTestId('mock-review-next-link'))
    expect(screen.getByTestId('mock-review-leave')).toHaveTextContent('Есть несохранённые баллы')
    expect(screen.getByTestId('where')).toHaveTextContent('/mock-exams/ex1/review/a')
  })

  it('проверенная и сохранённая работа — «Уведомить» уходит ровно этому ученику', async () => {
    mount('b')
    await screen.findByTestId('mock-review-title')
    expect(screen.getByTestId('mock-review-missing')).toHaveTextContent('все номера оценены')
    await act(async () => { fireEvent.click(screen.getByTestId('mock-review-notify')) })
    await waitFor(() => expect(db.rpcCalls.some(c => c.fn === 'notify_mock_exam_results')).toBe(true))
    expect(db.rpcCalls.find(c => c.fn === 'notify_mock_exam_results')!.args).toEqual({ p_mock_exam_id: 'ex1', p_student_ids: ['b'] })
  })

  it('правка после проверки гасит «Уведомить», пока не сохранено', async () => {
    mount('b')
    await screen.findByTestId('mock-review-title')
    fireEvent.click(pt(5, 2))
    expect(screen.queryByTestId('mock-review-notify')).toBeNull()
  })

  it('ученика нет в группе — словами, без экрана', async () => {
    mount('zzz')
    expect(await screen.findByTestId('mock-review-error')).toHaveTextContent('Этого ученика нет в группе пробника')
  })
})
