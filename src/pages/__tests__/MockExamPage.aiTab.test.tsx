/**
 * Вкладка «Проверка ИИ» пробника (письмо ЛК_пробник_вкладка_Проверка_ИИ.md, 28.10):
 * число ждущих ИИ в названии вкладки, «у всех» — одной заявкой в очередь и не
 * больше трёх вызовов функции разом, таблица по ученикам с предложениями и
 * уверенностью, повтор по одному, предупреждение о нехватке эталона, значок в «Работах».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { examRow, fakeSupabase, PHOTOS, resultsAfter, ROSTER, scoresAfter, sheetsAfter, stu, type Db } from './mockExamV3Fixture'

let db: Db
vi.mock('@/lib/supabase', async () => ({ supabase: fakeSupabase(() => db) }))
vi.mock('@/hooks/useMockExamLive', () => ({ useMockExamLive: () => ({ live: null, error: null, offset: 0 }) }))
vi.mock('@/pages/MockExamGridPage', () => ({ MockExamGridPage: () => <div data-testid="grid-stub" /> }))
vi.mock('@/components/mockExams/MockExamForm', () => ({ MockExamForm: () => <div data-testid="form-stub" /> }))

import { MockExamPage } from '@/pages/MockExamPage'

function Search() { return <div data-testid="search">{useLocation().search}</div> }

function mount(url = '/mock-exams/ex1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/mock-exams/:id" element={<><MockExamPage /><Search /></>} /></Routes>
    </MemoryRouter>,
  )
}
const sug = (student: string, task_number: number, points: number, confidence = 'high') =>
  ({ student_id: student, task_number, points, max_points: 3, confidence, comment: null, regions: [], created_at: null })
const photo = (id: string) => ({ id: `ph-${id}`, student_id: id, storage_path: `ex1/photos/${id}/1.jpg`, file_name: '1.jpg', position: 0 })
const rowOf = (testid: string, id: string) => screen.getAllByTestId(testid).find(r => r.dataset.student === id)!

beforeEach(() => {
  db = {
    exam: examRow(-6 * 60),
    tables: {
      group_students: ROSTER, mock_exam_task_scores: scoresAfter(), mock_exam_sheets: sheetsAfter(), mock_exam_results: resultsAfter(),
      // Фото у a (предложения есть), b и d (без предложений); у c работы нет.
      mock_exam_photos: [...PHOTOS, photo('b'), photo('d')],
      mock_exam_ai_suggestions: [sug('a', 4, 1, 'medium'), sug('a', 5, 2)],
      mock_exam_ai_runs: [],
    },
    rpcCalls: [],
  }
})

describe('вкладка «Проверка ИИ»', () => {
  it('в названии — сколько работ с фото ждут ИИ; ?tab=ai в адресе', async () => {
    mount()
    const tab = await screen.findByTestId('mock-tab-ai')
    expect(tab).toHaveTextContent('Проверка ИИ · 2')
    fireEvent.click(tab)
    expect(screen.getByTestId('search')).toHaveTextContent('tab=ai')
    expect(await screen.findByTestId('mock-ai-tab')).toBeInTheDocument()
  })

  it('крупная кнопка с пояснением; таблица: статус, предложения с уверенностью, ссылка на проверку', async () => {
    mount('/mock-exams/ex1?tab=ai')
    const panel = await screen.findByTestId('mock-ai-tab')
    expect(within(panel).getByTestId('mock-ai-tab-check-all')).toHaveTextContent('Проверить вторую часть ИИ — у всех (2)')
    expect(panel).toHaveTextContent('ИИ ставит баллы-предложения по 4–5 по решению и критериям варианта; ученик их не видит, вы принимаете на экране проверки')
    const rowA = rowOf('mock-ai-tab-row', 'a')
    expect(within(rowA).getByTestId('mock-ai-badge')).toHaveTextContent('ИИ: готово')
    const tasks = within(rowA).getAllByTestId('mock-ai-tab-task')
    expect(tasks.map(t => [t.dataset.task, t.dataset.confidence, t.textContent])).toEqual([
      ['4', 'medium', '№41/2?'], ['5', 'high', '№52/3'],
    ])
    expect(within(rowA).getByTestId('mock-ai-tab-run')).toHaveTextContent('Повторить')
    expect(within(rowA).getByTestId('mock-ai-tab-open')).toHaveAttribute('href', '/mock-exams/ex1/review/a')
    const rowB = rowOf('mock-ai-tab-row', 'b')
    expect(within(rowB).getByTestId('mock-ai-badge')).toHaveTextContent('ИИ: не проверял')
    expect(within(rowB).getByTestId('mock-ai-tab-run')).toHaveTextContent('Проверить ИИ')
    // Без фото проверять нечего — кнопки нет, ссылка на проверку есть.
    expect(within(rowOf('mock-ai-tab-row', 'c')).queryByTestId('mock-ai-tab-run')).toBeNull()
  })

  it('ошибка ИИ — с текстом; идёт — кнопка ученика занята', async () => {
    const t = new Date().toISOString()
    db.tables.mock_exam_ai_runs = [
      { student_id: 'b', status: 'error', last_error: 'нет фото второй части', note: null, requested_at: t, started_at: t, finished_at: t },
      { student_id: 'd', status: 'running', last_error: null, note: null, requested_at: t, started_at: t, finished_at: null },
    ]
    mount('/mock-exams/ex1?tab=ai')
    await screen.findByTestId('mock-ai-tab')
    expect(within(rowOf('mock-ai-tab-row', 'b')).getByTestId('mock-ai-badge')).toHaveTextContent('ИИ: ошибка')
    expect(within(rowOf('mock-ai-tab-row', 'b')).getByTestId('mock-ai-tab-error')).toHaveTextContent('нет фото второй части')
    expect(within(rowOf('mock-ai-tab-row', 'b')).getByTestId('mock-ai-tab-run')).toHaveTextContent('Повторить')
    expect(within(rowOf('mock-ai-tab-row', 'd')).getByTestId('mock-ai-badge')).toHaveTextContent('ИИ: идёт')
    expect(within(rowOf('mock-ai-tab-row', 'd')).getByTestId('mock-ai-tab-run')).toBeDisabled()
  })

  it('«у всех» — одна заявка в очередь, функция по одному ученику и не больше трёх разом', async () => {
    const extra = ['e', 'f', 'g', 'h', 'i']
    db.tables.group_students = [...ROSTER, ...extra.map((id, i) => stu(id, `Ученик ${i + 1}`))]
    db.tables.mock_exam_photos = [...db.tables.mock_exam_photos, ...extra.map(photo)]
    let running = 0
    let peak = 0
    db.invokeGate = async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise(r => setTimeout(r, 20))
      running -= 1
    }
    db.onInvoke = (_n, body) => { (db.tables.mock_exam_ai_suggestions as unknown[]).push(sug((body.student_ids as string[])[0], 5, 1)) }
    mount('/mock-exams/ex1?tab=ai')
    const btn = await screen.findByTestId('mock-ai-tab-check-all')
    expect(btn).toHaveTextContent('у всех (7)')
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => expect(screen.getByTestId('mock-ai-tab-status')).toHaveTextContent('ИИ проверил 7 работ'), { timeout: 4000 })
    const reqs = db.rpcCalls.filter(c => c.fn === 'mock_exam_ai_request_check')
    expect(reqs).toHaveLength(1)
    expect((reqs[0].args.p_student_ids as string[]).slice().sort()).toEqual(['b', 'd', ...extra].sort())
    expect(db.invokes).toHaveLength(7)
    expect(db.invokes!.every(i => (i.body.student_ids as string[]).length === 1)).toBe(true)
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it('«Повторить» у одного — заявка только на него, даже с готовыми предложениями', async () => {
    mount('/mock-exams/ex1?tab=ai')
    await screen.findByTestId('mock-ai-tab')
    await act(async () => { fireEvent.click(within(rowOf('mock-ai-tab-row', 'a')).getByTestId('mock-ai-tab-run')) })
    await waitFor(() => expect(db.invokes).toHaveLength(1))
    expect(db.rpcCalls.find(c => c.fn === 'mock_exam_ai_request_check')!.args).toEqual({ p_mock_exam_id: 'ex1', p_student_ids: ['a'] })
    expect(db.invokes![0].body).toEqual({ mock_exam_id: 'ex1', student_ids: ['a'] })
  })

  it('нет решения у пробника без вариантов — предупреждение «ИИ проверит хуже»', async () => {
    db.exam = { ...examRow(-6 * 60), solution_path: null }
    mount('/mock-exams/ex1?tab=ai')
    expect(await screen.findByTestId('mock-ai-tab-warning')).toHaveTextContent('ИИ проверит хуже: у пробника нет решения — загрузите его в «Настройке».')
  })

  it('у варианта ученика с фото нет критериев — предупреждение называет вариант; у чужого — молчит', async () => {
    db.tables.mock_exam_variants = [
      { id: 'v1', position: 1, label: null, condition_path: 'c1', solution_path: 's1', criteria_path: null },
      { id: 'v2', position: 2, label: null, condition_path: 'c2', solution_path: null, criteria_path: null },
    ]
    db.tables.mock_exam_variant_students = [
      { student_id: 'a', variant_id: 'v1' }, { student_id: 'b', variant_id: 'v1' },
      { student_id: 'd', variant_id: 'v1' }, { student_id: 'c', variant_id: 'v2' },
    ]
    mount('/mock-exams/ex1?tab=ai')
    const warns = await screen.findAllByTestId('mock-ai-tab-warning')
    expect(warns.map(w => w.textContent)).toEqual(['ИИ проверит хуже: у «Вариант 1» нет критериев — загрузите в «Настройке».'])
  })
})

describe('«Работы»: значок ИИ и ссылка во вкладку', () => {
  it('у учеников с фото — значок статуса ИИ, ведёт на ?tab=ai; без фото — нет', async () => {
    mount('/mock-exams/ex1?tab=works')
    await screen.findByTestId('mock-works-table')
    expect(within(rowOf('mock-works-row', 'a')).getByTestId('mock-ai-badge')).toHaveTextContent('ИИ: готово')
    expect(within(rowOf('mock-works-row', 'b')).getByTestId('mock-ai-badge')).toHaveTextContent('ИИ: не проверял')
    expect(within(rowOf('mock-works-row', 'c')).queryByTestId('mock-ai-badge')).toBeNull()
    fireEvent.click(within(rowOf('mock-works-row', 'b')).getByTestId('mock-works-ai'))
    expect(screen.getByTestId('search')).toHaveTextContent('tab=ai')
    expect(await screen.findByTestId('mock-ai-tab')).toBeInTheDocument()
  })

  it('полоса ИИ над «Работами» ведёт во вкладку', async () => {
    mount('/mock-exams/ex1?tab=works')
    fireEvent.click(await screen.findByTestId('mock-ai-open-tab'))
    expect(await screen.findByTestId('mock-ai-tab')).toBeInTheDocument()
  })
})
