import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import type { AiJobRow } from '@/lib/aiHomeworkCheck'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'

/**
 * §214 (board/066). Пятый вердикт на экране проверки.
 *
 * «Не сверено» тащило два смысла: «ИИ не смогла сверить — надо посмотреть
 * глазами» и «ученик не решал — надо садиться и делать». Для преподавателя
 * это разные действия, и различать их он должен на экране, а не в уме.
 */

const job = (over: Partial<AiJobRow> = {}): AiJobRow => ({
  id: 'j1',
  attempt_id: 'a1',
  status: 'done',
  provider: 'openrouter',
  model: 'qwen/qwen3-vl-235b-a22b-instruct',
  readable: true,
  suggested_score: 4,
  confidence: 'high',
  summary: 'Разбор',
  last_error: null,
  reference_state: 'used',
  reference_chars: 4200,
  worksheet_state: 'used',
  worksheet_chars: 900,
  tasks: null,
  dropped_findings: 0,
  accepted_at: null,
  created_at: '2026-09-19T10:00:00Z',
  completed_at: '2026-09-19T10:01:00Z',
  ...over,
})

const row = (no: string, verdict: ReviewTaskRow['verdict']): ReviewTaskRow => ({
  id: `r${no}`,
  attempt_id: 'a1',
  no,
  verdict,
  student_answer: null,
  expected_answer: null,
  note: null,
  position: Number(no) * 10,
  updated_by: null,
  updated_at: '2026-09-19T10:05:00Z',
})

/** Две «не сверено» и две «не решено» — чтобы их было чем различать. */
const ROWS: ReviewTaskRow[] = [
  row('1', 'correct'),
  row('2', 'wrong'),
  row('3', 'unchecked'),
  row('4', 'unsolved'),
  row('5', 'unsolved'),
  row('6', 'unchecked'),
]

function table(props: Partial<React.ComponentProps<typeof ReviewTaskTable>> = {}) {
  return render(
    <ReviewTaskTable
      job={job()}
      findings={[]}
      running={false}
      error={null}
      onRun={() => {}}
      tasks={ROWS}
      gradeScale="five"
      onPatchTask={vi.fn(async () => true)}
      onRemoveTask={vi.fn(async () => true)}
      onAddTask={vi.fn(async () => true)}
      {...props}
    />,
  )
}

const visibleNos = () => screen.queryAllByTestId('review-task-row').map(r => r.dataset.no)
const chip = (kind: string) => screen.getByTestId(`review-tasks-filter-${kind}`)

beforeEach(() => { cleanup(); sessionStorage.clear() })

describe('§214 — список вердиктов', () => {
  it('в списке пять значений, пятое — «не решено»', async () => {
    table()
    fireEvent.click(screen.getAllByTestId('review-task-verdict')[0])

    const option = await screen.findByTestId('review-task-verdict-option-unsolved')
    expect(option).toHaveTextContent('не решено')
    expect(screen.getByTestId('review-task-verdict-option-unchecked')).toHaveTextContent('не сверено')
    expect(screen.getAllByRole('option')).toHaveLength(5)
  })

  it('выбор «не решено» сохраняется этой строке', async () => {
    const onPatchTask = vi.fn(async () => true)
    table({ onPatchTask })
    fireEvent.click(screen.getAllByTestId('review-task-verdict')[0])
    fireEvent.click(await screen.findByTestId('review-task-verdict-option-unsolved'))

    await waitFor(() => expect(onPatchTask).toHaveBeenCalledWith('r1', { verdict: 'unsolved' }))
  })

  it('строка помечена своим вердиктом — «не решено» отличимо от «не сверено»', () => {
    table()
    const rows = screen.queryAllByTestId('review-task-row')
    expect(rows.find(r => r.dataset.no === '4')?.dataset.verdict).toBe('unsolved')
    expect(rows.find(r => r.dataset.no === '3')?.dataset.verdict).toBe('unchecked')
  })
})

describe('§214 — клавиша 5', () => {
  it('ставит «не решено» так же, как 1–4 ставят свои', async () => {
    const onPatchTask = vi.fn(async () => true)
    table({ onPatchTask })
    const list = screen.getByTestId('ai-check-tasks').querySelector('[role="listbox"]') as HTMLElement
    list.focus()

    fireEvent.keyDown(list, { key: '5' })

    await waitFor(() => expect(onPatchTask).toHaveBeenCalledWith('r1', { verdict: 'unsolved' }))
  })

  it('клавиша 4 по-прежнему ставит «не сверено» — ряд не сдвинулся', async () => {
    const onPatchTask = vi.fn(async () => true)
    table({ onPatchTask })
    const list = screen.getByTestId('ai-check-tasks').querySelector('[role="listbox"]') as HTMLElement
    list.focus()

    fireEvent.keyDown(list, { key: '4' })

    await waitFor(() => expect(onPatchTask).toHaveBeenCalledWith('r1', { verdict: 'unchecked' }))
  })
})

describe('§214 — пятый счётчик-фильтр', () => {
  it('счётчик показывает, сколько заданий не решено', () => {
    table()
    expect(chip('unsolved')).toHaveTextContent('2 не решено')
    expect(chip('unchecked')).toHaveTextContent('2 не сверено')
  })

  it('фильтр оставляет только нерешённые', () => {
    table()
    fireEvent.click(chip('unsolved'))
    expect(visibleNos()).toEqual(['4', '5'])
    expect(chip('unsolved')).toHaveAttribute('aria-pressed', 'true')
  })

  it('повторное нажатие снимает фильтр — как у остальных четырёх', () => {
    table()
    fireEvent.click(chip('unsolved'))
    fireEvent.click(chip('unsolved'))
    expect(visibleNos()).toHaveLength(6)
  })

  it('ноль — кнопка выключена', () => {
    table({ tasks: [row('1', 'correct'), row('2', 'unchecked')] })
    expect(chip('unsolved')).toHaveTextContent('0 не решено')
    expect(chip('unsolved')).toBeDisabled()
    expect(chip('unchecked')).not.toBeDisabled()
  })
})

describe('§214 — рекомендуемый балл в полосе счётчиков', () => {
  it('две верные и две нерешённые — 2 из 4, то есть 3', () => {
    table({ tasks: [row('1', 'correct'), row('2', 'correct'), row('3', 'unsolved'), row('4', 'unsolved')] })
    expect(screen.getByTestId('ai-check-tasks-score')).toHaveTextContent('3')
  })

  it('те же строки с «не сверено» вместо «не решено» — 5: незнание балл не роняет', () => {
    table({ tasks: [row('1', 'correct'), row('2', 'correct'), row('3', 'unchecked'), row('4', 'unchecked')] })
    expect(screen.getByTestId('ai-check-tasks-score')).toHaveTextContent('5')
  })
})
