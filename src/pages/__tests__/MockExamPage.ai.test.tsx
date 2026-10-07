/**
 * §222b. «Работы» пробника: «Вторая часть · ИИ: проверено N из M» и
 * «Проверить вторую часть ИИ — у всех» — только ученики с фото и без
 * предложений, по одному вызову функции на ученика.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { examRow, fakeSupabase, PHOTOS, resultsAfter, ROSTER, scoresAfter, sheetsAfter, type Db } from './mockExamV3Fixture'

let db: Db
vi.mock('@/lib/supabase', async () => ({ supabase: fakeSupabase(() => db) }))
vi.mock('@/hooks/useMockExamLive', () => ({ useMockExamLive: () => ({ live: null, error: null, offset: 0 }) }))
vi.mock('@/pages/MockExamGridPage', () => ({ MockExamGridPage: () => <div data-testid="grid-stub" /> }))
vi.mock('@/components/mockExams/MockExamForm', () => ({ MockExamForm: () => <div data-testid="form-stub" /> }))

import { MockExamPage } from '@/pages/MockExamPage'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/mock-exams/ex1']}>
      <Routes><Route path="/mock-exams/:id" element={<MockExamPage />} /></Routes>
    </MemoryRouter>,
  )
}
const sug = (student: string, task_number: number, points: number) =>
  ({ student_id: student, task_number, points, max_points: 3, confidence: 'high', comment: null, regions: [], created_at: null })

beforeEach(() => {
  db = {
    exam: examRow(-6 * 60),
    tables: {
      group_students: ROSTER, mock_exam_task_scores: scoresAfter(), mock_exam_sheets: sheetsAfter(), mock_exam_results: resultsAfter(),
      // Фото у a (предложения уже есть), d и b (без предложений); у c работы нет.
      mock_exam_photos: [
        ...PHOTOS,
        { id: 'ph3', student_id: 'd', storage_path: 'ex1/photos/d/1.jpg', file_name: '1.jpg', position: 0 },
        { id: 'ph4', student_id: 'b', storage_path: 'ex1/photos/b/1.jpg', file_name: '1.jpg', position: 0 },
      ],
      mock_exam_ai_suggestions: [sug('a', 5, 2)],
      mock_exam_ai_runs: [],
    },
    rpcCalls: [],
  }
})

describe('ИИ во вкладке «Работы»', () => {
  it('прогресс и «у всех»: заявка на учеников без предложений, функция — по одному', async () => {
    db.onInvoke = (_name, body) => {
      const id = (body.student_ids as string[])[0]
      ;(db.tables.mock_exam_ai_suggestions as unknown[]).push(sug(id, 5, 1))
    }
    mount()
    expect(await screen.findByTestId('mock-ai-progress')).toHaveTextContent('Вторая часть · ИИ: проверено 1 из 3')
    const btn = screen.getByTestId('mock-ai-check-all')
    expect(btn).toHaveTextContent('Проверить вторую часть ИИ — у всех · 2')
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => expect(screen.getByTestId('mock-ai-status')).toHaveTextContent('ИИ проверил 2 работы'))
    expect(db.rpcCalls.find(c => c.fn === 'mock_exam_ai_request_check')!.args).toEqual({ p_mock_exam_id: 'ex1', p_student_ids: ['b', 'd'] })
    expect(db.invokes!.map(i => i.body)).toEqual([
      { mock_exam_id: 'ex1', student_ids: ['b'] },
      { mock_exam_id: 'ex1', student_ids: ['d'] },
    ])
    expect(screen.getByTestId('mock-ai-progress')).toHaveTextContent('проверено 3 из 3')
    expect(screen.getByTestId('mock-ai-check-all')).toBeDisabled()
    // Ученикам ничего не уходит.
    expect(db.rpcCalls.some(c => c.fn === 'notify_mock_exam_results')).toBe(false)
  })

  it('идёт проверка — показано и кнопка занята', async () => {
    db.tables.mock_exam_ai_runs = [{ student_id: 'd', status: 'running', last_error: null, note: null, requested_at: new Date().toISOString(), started_at: new Date().toISOString(), finished_at: null }]
    mount()
    expect(await screen.findByTestId('mock-ai-progress')).toHaveTextContent('идёт: 1')
    expect(screen.getByTestId('mock-ai-check-all')).toBeDisabled()
  })

  it('пока пробник идёт — полосы ИИ нет', async () => {
    db.exam = examRow(-30)
    mount()
    await screen.findByTestId('mock-exam-page')
    expect(screen.queryByTestId('mock-ai-bar')).toBeNull()
  })
})
