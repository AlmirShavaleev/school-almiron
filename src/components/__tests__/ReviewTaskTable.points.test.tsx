import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import { ReviewTaskFocus } from '@/components/courseProgram/ReviewTaskFocus'
import type { AiJobRow, AiTaskRow } from '@/lib/aiHomeworkCheck'
import { couplePointsPatch, reviewTableScore, type ReviewTaskPatch, type ReviewTaskRow } from '@/lib/homeworkReviewTasks'

/**
 * §260. Баллы по критериям учителя в таблице проверки — по макету
 * (`a260/maket.html`): «9 из 12 баллов», оценка, таблица перевода с
 * подсвеченной строкой, у задания «2 из 3» с ±. Правка ± пересчитывает сумму
 * и оценку на экране; без баллов вид прежний.
 *
 * Работа — с проверочной 10А 03.10 (9 из 12 → «4»), ученик условный.
 */

const TABLE = [
  { min: 0, max: 4, grade: 2 },
  { min: 5, max: 7, grade: 3 },
  { min: 8, max: 10, grade: 4 },
  { min: 11, max: 12, grade: 5 },
]

// №, ответ, эталон, балл, максимум.
const WORK: Array<[string, string, string, number, number]> = [
  ['1', 'T = 0,2 с', 'T = 0,2 с; ν = 5 Гц', 0, 1],
  ['2', '3,1 м/с', '3,1 м/с', 1, 1],
  ['3', '5 м/с²', '5 м/с²', 1, 1],
  ['4', 'в 9 раз', 'в 9 раз', 1, 1],
  ['5', '15 оборотов', '15 оборотов', 1, 1],
  ['6', '112', '112', 2, 2],
  ['7', 'T ≈ 0,67 с', 'T ≈ 0,67 с; v ≈ 0,38 м/с', 1, 2],
  ['8', 'ν ≈ 4,0 об/с; a = 250 м/с²', 'а) 4,0 об/с; б) 250 м/с²; в) N ≈ 398', 2, 3],
]
const verdictOf = (p: number, m: number): 'correct' | 'wrong' | 'partial' => (p >= m ? 'correct' : p <= 0 ? 'wrong' : 'partial')

const AI_TASKS: AiTaskRow[] = WORK.map(([no, a, e, p, m]) => ({
  no, verdict: verdictOf(p, m), student_answer: a, expected_answer: e, note: '', points: p, max_points: m,
}))

const ROWS: ReviewTaskRow[] = WORK.map(([no, a, e, p, m], i) => ({
  id: `r${no}`, attempt_id: 'a1', no, verdict: verdictOf(p, m), student_answer: a, expected_answer: e,
  note: null, position: (i + 1) * 10, updated_by: null, updated_at: '2026-10-03T10:05:00Z', points: p, max_points: m,
}))

const job = (over: Partial<AiJobRow> = {}): AiJobRow => ({
  id: 'j1', attempt_id: 'a1', status: 'done', provider: 'openrouter', model: 'google/gemini-3.8-flash',
  readable: true, suggested_score: 4, confidence: 'high', summary: 'Разбор', last_error: null,
  reference_state: 'used', reference_chars: 4200, worksheet_state: 'used', worksheet_chars: 900,
  tasks: AI_TASKS, dropped_findings: 0, accepted_at: null,
  created_at: '2026-10-03T10:00:00Z', completed_at: '2026-10-03T10:01:00Z',
  points_total: 9, points_max: 12, grade_table: TABLE, grading: 'criteria',
  ...over,
})

/** Таблица с живым состоянием: правка идёт через ту же связку балл ↔ вердикт, что в хуке. */
function Stateful({ initial, jobRow, onPatch }: { initial: ReviewTaskRow[]; jobRow: AiJobRow; onPatch?: (id: string, p: ReviewTaskPatch) => void }) {
  const [rows, setRows] = useState(initial)
  return (
    <>
      <ReviewTaskTable
        job={jobRow}
        findings={[]}
        running={false}
        error={null}
        onRun={() => {}}
        tasks={rows}
        gradeScale="five"
        onPatchTask={async (id, raw) => {
          onPatch?.(id, raw)
          setRows(current => current.map(row => (row.id === id ? { ...row, ...couplePointsPatch(row, raw) } : row)))
          return true
        }}
      />
      {/* То, что увидит кнопка «Принять» внизу экрана. */}
      <output data-testid="accept-score">{reviewTableScore(rows, 'five', jobRow).score ?? '—'}</output>
    </>
  )
}

const pointsOf = (no: string) => {
  const line = screen.getAllByTestId('review-task-row').find(el => el.getAttribute('data-no') === no)!
  return within(line).getByTestId('review-task-points')
}
const onRow = () => screen.getAllByTestId('criteria-points-scale-row').filter(el => el.getAttribute('data-on') === 'true').map(el => el.textContent)

describe('§260. таблица проверки с баллами по критериям', () => {
  it('сверху «9 из 12 баллов», оценка «4», подсвечена строка «8–10 → 4»; у задания «2 из 3»', () => {
    render(<Stateful initial={ROWS} jobRow={job()} />)
    expect(screen.getByTestId('criteria-points-total').textContent).toBe('9')
    expect(screen.getByTestId('criteria-points').textContent).toContain('из 12 баллов')
    expect(screen.getByTestId('criteria-points-mark').textContent).toBe('4')
    expect(onRow()).toEqual(['8–10 → 4'])
    expect(pointsOf('8').textContent).toContain('2 из 3')
    expect(pointsOf('1').getAttribute('data-points')).toBe('0')
    expect(screen.getByTestId('accept-score').textContent).toBe('4')
  })

  it('«+» у №1 и №7: 11 из 12 → «5», вердикты идут за баллами; «−» у №6 → 10 → «4»', () => {
    const onPatch = vi.fn()
    render(<Stateful initial={ROWS} jobRow={job()} onPatch={onPatch} />)
    fireEvent.click(within(pointsOf('1')).getByTestId('review-task-points-plus'))
    expect(onPatch).toHaveBeenLastCalledWith('r1', { points: 1 })
    expect(screen.getByTestId('criteria-points-total').textContent).toBe('10')
    expect(screen.getByTestId('criteria-points-mark').textContent).toBe('4')

    fireEvent.click(within(pointsOf('7')).getByTestId('review-task-points-plus'))
    expect(screen.getByTestId('criteria-points-total').textContent).toBe('11')
    expect(screen.getByTestId('criteria-points-mark').textContent).toBe('5')
    expect(onRow()).toEqual(['11–12 → 5'])
    expect(screen.getByTestId('accept-score').textContent).toBe('5')
    const row7 = screen.getAllByTestId('review-task-row').find(el => el.getAttribute('data-no') === '7')!
    expect(row7.getAttribute('data-verdict')).toBe('correct')

    fireEvent.click(within(pointsOf('6')).getByTestId('review-task-points-minus'))
    expect(screen.getByTestId('criteria-points-total').textContent).toBe('10')
    expect(screen.getByTestId('criteria-points-mark').textContent).toBe('4')
    const row6 = screen.getAllByTestId('review-task-row').find(el => el.getAttribute('data-no') === '6')!
    expect(row6.getAttribute('data-verdict')).toBe('partial')
  })

  it('на границах «+» и «−» выключены: полный балл не растёт, ноль не уходит в минус', () => {
    render(<Stateful initial={ROWS} jobRow={job()} />)
    expect((within(pointsOf('6')).getByTestId('review-task-points-plus') as HTMLButtonElement).disabled).toBe(true)
    expect((within(pointsOf('1')).getByTestId('review-task-points-minus') as HTMLButtonElement).disabled).toBe(true)
  })

  it('критерии прочитаны не полностью: пометка с причиной, оценки нет, «Принять» без балла', () => {
    const summary = 'Разбор\n\nПроверьте баллы: критерии прочитаны не полностью (сумма максимумов по заданиям 12, а в критериях максимум 13). Оценка не подставлена — сверьте баллы с критериями.'
    render(<Stateful initial={ROWS} jobRow={job({ grading: 'criteria_mismatch', suggested_score: null, confidence: 'medium', summary })} />)
    const note = screen.getByTestId('criteria-points-mismatch')
    expect(note.textContent).toContain('Проверьте баллы — критерии прочитаны не полностью')
    expect(note.textContent).toContain('сумма максимумов по заданиям 12, а в критериях максимум 13')
    expect(screen.queryByTestId('criteria-points-mark')).toBeNull()
    expect(onRow()).toEqual([])
    expect(screen.getByTestId('accept-score').textContent).toBe('—')
    // Это не «прочитана не вся работа» — своя причина.
    expect(screen.queryByTestId('ai-check-partial')).toBeNull()
    expect(screen.getByTestId('ai-check-criteria-mismatch')).toBeTruthy()
  })

  it('без баллов (обычное ДЗ) — прежний вид: ни шапки баллов, ни ±, «1 / 1» у задания', () => {
    const plain = ROWS.map(({ points: _p, max_points: _m, ...row }) => row)
    render(<Stateful initial={plain} jobRow={job({ grading: null, points_total: null, points_max: null, grade_table: null, tasks: AI_TASKS.map(({ points: _p, max_points: _m, ...t }) => t) })} />)
    expect(screen.queryByTestId('criteria-points')).toBeNull()
    expect(screen.queryByTestId('review-task-points-plus')).toBeNull()
    expect(pointsOf('1').textContent).toBe('0 / 1')
    expect(pointsOf('2').textContent).toBe('1 / 1')
  })

  it('«Перепроверить по критериям» — у проверочной, проверенной ИИ без баллов', () => {
    const old = job({ grading: null, points_total: null, points_max: null, grade_table: null })
    const { rerender } = render(
      <ReviewTaskTable job={old} findings={[]} running={false} error={null} onRun={() => {}} tasks={[]} gradeScale="five" criteriaRecheck />,
    )
    expect(screen.getByTestId('ai-check-run').textContent).toContain('Перепроверить по критериям')
    // Уже с баллами — обычное «Проверить заново»; у обычного ДЗ — тоже.
    rerender(<ReviewTaskTable job={job()} findings={[]} running={false} error={null} onRun={() => {}} tasks={[]} gradeScale="five" criteriaRecheck />)
    expect(screen.getByTestId('ai-check-run').textContent).toContain('Проверить заново')
    rerender(<ReviewTaskTable job={old} findings={[]} running={false} error={null} onRun={() => {}} tasks={[]} gradeScale="five" />)
    expect(screen.getByTestId('ai-check-run').textContent).toContain('Проверить заново')
  })

  it('слепок ИИ (своей таблицы ещё нет) показывает баллы только для чтения', () => {
    render(<ReviewTaskTable job={job()} findings={[]} running={false} error={null} onRun={() => {}} tasks={[]} gradeScale="five" />)
    expect(screen.getByTestId('criteria-points-total').textContent).toBe('9')
    const points = screen.getAllByTestId('ai-task-points').map(el => el.textContent)
    expect(points).toEqual(['0 из 1', '1 из 1', '1 из 1', '1 из 1', '1 из 1', '2 из 2', '1 из 2', '2 из 3'])
  })
})

describe('§260. спокойный экран: балл текущего задания и сумма', () => {
  function Focus({ jobRow, onRun }: { jobRow: AiJobRow; onRun?: () => void }) {
    const [rows, setRows] = useState(ROWS)
    const [no, setNo] = useState<string | null>('7')
    return (
      <ReviewTaskFocus
        tasks={rows}
        job={jobRow}
        currentNo={no}
        onCurrentChange={setNo}
        gradeScale="five"
        criteriaRecheck
        onRun={onRun}
        keyboard={false}
        onPatchTask={async (id, raw) => {
          setRows(current => current.map(row => (row.id === id ? { ...row, ...couplePointsPatch(row, raw) } : row)))
          return true
        }}
      />
    )
  }

  it('«Баллы по критериям: 1 из 2» с ±; «+» — сумма 10, оценка та же; кнопка вердикта «Верно» ставит полный балл', () => {
    render(<Focus jobRow={job()} />)
    const box = screen.getByTestId('review-focus-points')
    expect(box.textContent).toContain('1 из 2')
    expect(screen.getByTestId('criteria-points-total').textContent).toBe('9')
    fireEvent.click(within(box).getByTestId('review-task-points-plus'))
    expect(screen.getByTestId('review-focus-points').textContent).toContain('2 из 2')
    expect(screen.getByTestId('criteria-points-total').textContent).toBe('10')
    fireEvent.click(screen.getAllByTestId('review-focus-cell').find(el => el.getAttribute('data-no') === '8')!)
    fireEvent.click(screen.getByTestId('review-focus-verdict-correct'))
    expect(screen.getByTestId('review-focus-points').textContent).toContain('3 из 3')
    expect(screen.getByTestId('criteria-points-total').textContent).toBe('11')
    expect(screen.getByTestId('criteria-points-mark').textContent).toBe('5')
  })

  it('проверка без баллов у проверочной — строка «Перепроверить по критериям»', () => {
    const onRun = vi.fn()
    render(<ReviewTaskFocus
      tasks={ROWS.map(({ points: _p, max_points: _m, ...row }) => row)}
      job={job({ grading: null, points_total: null, points_max: null, grade_table: null })}
      currentNo="1"
      onCurrentChange={() => {}}
      criteriaRecheck
      onRun={onRun}
      keyboard={false}
    />)
    fireEvent.click(screen.getByTestId('ai-check-rerun-criteria'))
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('review-focus-points')).toBeNull()
  })
})
