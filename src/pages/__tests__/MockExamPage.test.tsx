/**
 * §228. Страница пробника: статус, вывод, «Работы» (вся строка открывает
 * проверку; «Уведомить» одному — когда все номера оценены), вкладки.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { examRow, fakeSupabase, PHOTOS, resultsAfter, ROSTER, scoresAfter, sheetsAfter, type Db } from './mockExamV3Fixture'

let db: Db
vi.mock('@/lib/supabase', async () => ({ supabase: fakeSupabase(() => db) }))
vi.mock('@/hooks/useMockExamLive', () => ({ useMockExamLive: () => ({ live: null, error: null, offset: 0 }) }))
vi.mock('@/pages/MockExamGridPage', () => ({ MockExamGridPage: ({ embedded }: { embedded?: boolean }) => <div data-testid="grid-stub" data-embedded={embedded} /> }))
vi.mock('@/components/mockExams/MockExamForm', () => ({ MockExamForm: ({ mode }: { mode: { kind: string; examId?: string } }) => <div data-testid="form-stub" data-mode={mode.kind} data-exam={mode.examId} /> }))

import { MockExamPage } from '@/pages/MockExamPage'

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname}</div> }
function mount(url = '/mock-exams/ex1') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/mock-exams/:id" element={<MockExamPage />} />
        <Route path="/mock-exams/:id/review/:studentId" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

function after(): Db {
  return {
    exam: examRow(-6 * 60),
    tables: { group_students: ROSTER, mock_exam_task_scores: scoresAfter(), mock_exam_sheets: sheetsAfter(), mock_exam_photos: PHOTOS, mock_exam_results: resultsAfter() },
    rpcCalls: [],
  }
}

beforeEach(() => { db = after() })

describe('после окна — «Проверка»', () => {
  it('статус, вывод одной строкой, «Работы» по умолчанию: строки по алфавиту со статусами', async () => {
    mount()
    const rows = await screen.findAllByTestId('mock-works-row')
    expect(screen.getByTestId('mock-stepper')).toHaveAttribute('data-stage', 'checking')
    expect(screen.getByTestId('mock-tab-works')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('mock-page-summary')).toHaveTextContent('Сдали 3 из 4, проверено 1. Ждут проверки 2 работы. Не писал: Зайцев Р.')
    expect(rows.map(r => [r.getAttribute('data-student'), r.getAttribute('data-status')])).toEqual([
      ['b', 'checked'], ['a', 'waiting'], ['c', 'absent'], ['d', 'partial'],
    ])
    expect(within(rows[1]).getByTestId('mock-works-status-pill')).toHaveTextContent('ждёт проверки')
    expect(rows[1]).toHaveTextContent('2 фото')
    expect(rows[3]).toHaveTextContent('№5 не оценено')
    expect(within(rows[3]).getByTestId('mock-works-action')).toHaveTextContent('Дооценить →')
    // По ключу проверили до чтения баллов (как таблица §221).
    expect(db.rpcCalls[0].fn).toBe('grade_mock_exam_part1')
  })

  it('вся строка кликабельна → проверка работы этого ученика', async () => {
    mount()
    const rows = await screen.findAllByTestId('mock-works-row')
    fireEvent.click(rows[3].querySelector('td:nth-child(3)')!)
    expect(await screen.findByTestId('where')).toHaveTextContent('/mock-exams/ex1/review/d')
  })

  it('главная кнопка — «Проверить следующую · Гарипов Т.»', async () => {
    mount()
    fireEvent.click(await screen.findByTestId('mock-page-next'))
    expect(await screen.findByTestId('where')).toHaveTextContent('/mock-exams/ex1/review/a')
  })

  it('«Уведомить» одному — только у проверенного; шлёт ровно его и не открывает проверку', async () => {
    mount()
    const rows = await screen.findAllByTestId('mock-works-row')
    expect(within(rows[1]).queryByTestId('mock-works-notify')).toBeNull()
    await act(async () => { fireEvent.click(within(rows[0]).getByTestId('mock-works-notify')) })
    await waitFor(() => expect(db.rpcCalls.some(c => c.fn === 'notify_mock_exam_results')).toBe(true))
    expect(db.rpcCalls.find(c => c.fn === 'notify_mock_exam_results')!.args).toEqual({ p_mock_exam_id: 'ex1', p_student_ids: ['b'] })
    expect(screen.queryByTestId('where')).toBeNull()
    expect(screen.getByTestId('mock-works-status')).toHaveTextContent('Белов Артём: результат отправлен.')
  })

  it('«Уведомить всех проверенных · 1» — подтверждение на странице, уходят только проверенные', async () => {
    mount()
    const all = await screen.findByTestId('mock-works-notify-all')
    expect(all).toHaveTextContent('Уведомить всех проверенных · 1')
    fireEvent.click(all)
    expect(screen.getByTestId('mock-works-confirm')).toHaveTextContent('Отправить 1 ученику?')
    await act(async () => { fireEvent.click(screen.getByTestId('mock-works-notify-send')) })
    await waitFor(() => expect(db.rpcCalls.some(c => c.fn === 'notify_mock_exam_results')).toBe(true))
    expect(db.rpcCalls.find(c => c.fn === 'notify_mock_exam_results')!.args.p_student_ids).toEqual(['b'])
  })

  it('отправлено всем, у кого работа, — «Результаты отправлены»', async () => {
    const sent = (r: Record<string, unknown>) => ({ ...r, notified_at: '2026-10-03T12:00:00Z', notified_score: r.score, notified_part1_score: r.part1_score, notified_part2_score: r.part2_score })
    db.tables.mock_exam_results = resultsAfter().map(sent)
    mount()
    await screen.findAllByTestId('mock-works-row')
    expect(screen.getByTestId('mock-stepper')).toHaveAttribute('data-stage', 'sent')
    expect(within(screen.getAllByTestId('mock-works-row')[0]).getByTestId('mock-works-sent')).toHaveTextContent('отправлено')
  })
})

describe('вкладки', () => {
  it('«Таблица баллов» — таблица §218 встроенной; «Настройка» — форма этого пробника', async () => {
    mount('/mock-exams/ex1?tab=table')
    expect(await screen.findByTestId('grid-stub')).toHaveAttribute('data-embedded', 'true')
    fireEvent.click(screen.getByTestId('mock-tab-setup'))
    expect(screen.getByTestId('form-stub')).toHaveAttribute('data-exam', 'ex1')
  })

  it('черновик (без времени) — «Черновик», по умолчанию «Настройка»', async () => {
    db = { ...after(), exam: examRow(null), tables: { group_students: ROSTER } }
    mount()
    expect(await screen.findByTestId('form-stub')).toHaveAttribute('data-mode', 'edit')
    expect(screen.getByTestId('mock-stepper')).toHaveAttribute('data-stage', 'draft')
    expect(screen.getByTestId('mock-page-summary')).toHaveTextContent('Черновик: ученики пробник не видят')
    expect(screen.queryByTestId('mock-page-next')).toBeNull()
  })
})

describe('во время окна', () => {
  it('«Идёт»: шапка монитора на «Работах», «пишет сейчас» / «не заходил»', async () => {
    db = {
      exam: examRow(-60),
      tables: { group_students: ROSTER, mock_exam_sheets: [{ student_id: 'a', answers: ['5', null, null], submitted_at: null }, { student_id: 'b', answers: ['5', '8', '0,5'], submitted_at: new Date().toISOString() }] },
      rpcCalls: [],
    }
    mount()
    const rows = await screen.findAllByTestId('mock-works-row')
    expect(screen.getByTestId('mock-stepper')).toHaveAttribute('data-stage', 'running')
    expect(screen.getByTestId('mock-works-live')).toHaveAttribute('data-phase', 'running')
    expect(screen.getByTestId('mock-live-headline')).toHaveTextContent('Идёт · осталось')
    const status = Object.fromEntries(rows.map(r => [r.getAttribute('data-student'), r.getAttribute('data-status')]))
    expect(status).toEqual({ a: 'writing', b: 'waiting', c: 'not_opened', d: 'not_opened' })
    expect(within(rows.find(r => r.getAttribute('data-student') === 'a')!).getByTestId('mock-works-status-pill')).toHaveTextContent('пишет сейчас')
  })
})
