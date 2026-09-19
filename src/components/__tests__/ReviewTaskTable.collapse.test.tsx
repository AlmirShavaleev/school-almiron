import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import type { AiJobRow, AiTaskRow } from '@/lib/aiHomeworkCheck'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'

/**
 * §207. «Стало чище»: один счётчик, свёрнутые верные, свёрнутые одинаковые
 * «не сверено», видимая кнопка уборки повторов и честная строка про
 * устаревшую таблицу.
 *
 * Работа из 21 задания — та самая, на которой владелец жаловался на
 * перегруженность экрана.
 */

const AI_TASKS: AiTaskRow[] = [
  { no: '1', verdict: 'correct', student_answer: '5', expected_answer: '5', note: '' },
  { no: '2', verdict: 'wrong', student_answer: '2', expected_answer: '3', note: 'Знак' },
]

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
  tasks: AI_TASKS,
  dropped_findings: 0,
  accepted_at: null,
  created_at: '2026-09-19T10:00:00Z',
  completed_at: '2026-09-19T10:01:00Z',
  ...over,
})

const row = (no: string, verdict: ReviewTaskRow['verdict'], over: Partial<ReviewTaskRow> = {}): ReviewTaskRow => ({
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
  ...over,
})

/** 21 задание: 13 верных, 2 неверных, 1 частично, 5 «не сверено» с одной причиной. */
const ROWS_21: ReviewTaskRow[] = [
  ...Array.from({ length: 13 }, (_v, i) => row(String(i + 1), 'correct')),
  row('14', 'wrong', { note: 'Ошибка в решении: знак' }),
  row('15', 'wrong', { note: 'Правильный ход, но не доведено' }),
  row('16', 'partial', { note: 'Нет хода решения' }),
  ...Array.from({ length: 5 }, (_v, i) => row(String(i + 17), 'unchecked', { note: 'нет на фото' })),
]

function table(props: Partial<React.ComponentProps<typeof ReviewTaskTable>> = {}) {
  return render(
    <ReviewTaskTable
      job={job()}
      findings={[]}
      running={false}
      error={null}
      onRun={() => {}}
      tasks={ROWS_21}
      gradeScale="five"
      onPatchTask={vi.fn(async () => true)}
      onRemoveTask={vi.fn(async () => true)}
      onAddTask={vi.fn(async () => true)}
      {...props}
    />,
  )
}

const visibleNos = () => screen.queryAllByTestId('review-task-row').map(r => r.dataset.no)

describe('ReviewTaskTable — свёрнутые верные', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('по умолчанию верных в таблице нет — вместо них строка «13 верных»', () => {
    table()
    expect(screen.getByTestId('review-tasks-correct-toggle')).toHaveTextContent('13 верных')
    expect(visibleNos()).not.toContain('1')
    expect(visibleNos()).toContain('14')
  })

  it('по клику раскрываются все тринадцать', () => {
    table()
    fireEvent.click(screen.getByTestId('review-tasks-correct-toggle'))
    expect(visibleNos()).toContain('1')
    expect(visibleNos()).toContain('13')
  })

  it('раскрытие помнится на время сессии — на следующей работе не сворачивается', () => {
    const first = table()
    fireEvent.click(screen.getByTestId('review-tasks-correct-toggle'))
    first.unmount()
    table()
    expect(visibleNos()).toContain('1')
  })

  it('верных нет — нет и пачки', () => {
    table({ tasks: [row('1', 'wrong'), row('2', 'partial')] })
    expect(screen.queryByTestId('review-tasks-correct-pack')).not.toBeInTheDocument()
  })

  it('верных меньше трёх — пачки нет, строки видны сразу', () => {
    // Строка «2 верных» занимает столько же места, сколько сами задания.
    table({ tasks: [row('1', 'correct'), row('2', 'correct'), row('3', 'wrong')] })
    expect(screen.queryByTestId('review-tasks-correct-pack')).not.toBeInTheDocument()
    expect(visibleNos()).toEqual(['1', '2', '3'])
  })

  it('ровно три верных — уже пачка', () => {
    table({ tasks: [row('1', 'correct'), row('2', 'correct'), row('3', 'correct'), row('4', 'wrong')] })
    expect(screen.getByTestId('review-tasks-correct-toggle')).toHaveTextContent('3 верных')
    expect(visibleNos()).toEqual(['4'])
  })

  it('строка, которой вердикт поставили только что, не исчезает из-под курсора', () => {
    // Иначе правка прячет саму себя: поставил «верно» — строка ушла в пачку.
    const onPatchTask = vi.fn(async () => true)
    table({ onPatchTask })
    const line = screen.queryAllByTestId('review-task-row').find(r => r.dataset.no === '16')!
    fireEvent.click(within(line).getByTestId('review-task-verdict'))
    fireEvent.click(screen.getByTestId('review-task-verdict-option-correct'))
    expect(onPatchTask).toHaveBeenCalledWith('r16', { verdict: 'correct' })
    // Строка на экране (внешние данные в тесте не меняются, но и после их
    // прихода строка обязана остаться видимой).
    expect(visibleNos()).toContain('16')
  })
})

describe('ReviewTaskTable — свёрнутые «не сверено»', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('пять подряд с одной заметкой — одна строка с диапазоном', () => {
    table()
    const pack = screen.getByTestId('review-tasks-unchecked-pack')
    expect(pack.dataset.count).toBe('5')
    expect(screen.getByTestId('review-tasks-unchecked-toggle'))
      .toHaveTextContent('Задания 17–21 не сверены: нет на фото')
    expect(visibleNos()).not.toContain('17')
  })

  it('раскрывается по клику', () => {
    table()
    fireEvent.click(screen.getByTestId('review-tasks-unchecked-toggle'))
    expect(visibleNos()).toContain('17')
    expect(visibleNos()).toContain('21')
  })

  it('заметки разные — ничего не свёрнуто', () => {
    table({
      tasks: [
        row('17', 'unchecked', { note: 'нет на фото' }),
        row('18', 'unchecked', { note: 'не разобрал почерк' }),
      ],
    })
    expect(screen.queryByTestId('review-tasks-unchecked-pack')).not.toBeInTheDocument()
    expect(visibleNos()).toEqual(['17', '18'])
  })
})

describe('ReviewTaskTable — один счётчик', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('на экране ровно одна сводка, и она считает по таблице преподавателя', () => {
    table()
    expect(screen.getAllByTestId('ai-check-tasks-summary')).toHaveLength(1)
    expect(screen.getByTestId('ai-check-tasks-summary')).toHaveTextContent('верно 13')
    expect(screen.getByTestId('ai-check-tasks-summary')).toHaveTextContent('не сверено 5')
    expect(screen.queryByTestId('ai-check-summary-counts')).not.toBeInTheDocument()
  })
})

describe('ReviewTaskTable — «Заполнить заново из неё»', () => {
  beforeEach(() => { sessionStorage.clear() })

  /** Проверка новее таблицы: строки правили в 10:05, прогон кончился в 11:00. */
  const staleJob = job({ completed_at: '2026-09-19T11:00:00Z' })

  it('проверка новее таблицы — строка и кнопка есть', () => {
    table({ job: staleJob, onRefillFromAi: vi.fn(async () => true) })
    expect(screen.getByTestId('ai-check-stale')).toHaveTextContent('Есть более свежая проверка ИИ')
    expect(screen.getByTestId('ai-check-refill')).toBeInTheDocument()
  })

  it('таблица свежее проверки — ни строки, ни кнопки', () => {
    table({ onRefillFromAi: vi.fn(async () => true) })
    expect(screen.queryByTestId('ai-check-stale')).not.toBeInTheDocument()
  })

  it('первое нажатие только предупреждает, второе — заменяет', async () => {
    const onRefillFromAi = vi.fn(async () => true)
    table({ job: staleJob, onRefillFromAi })
    fireEvent.click(screen.getByTestId('ai-check-refill'))
    expect(screen.getByTestId('ai-check-refill-warning')).toHaveTextContent('правки пропадут')
    expect(onRefillFromAi).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('ai-check-refill-confirm'))
    await waitFor(() => expect(onRefillFromAi).toHaveBeenCalledTimes(1))
  })

  it('отмена ничего не заменяет', () => {
    const onRefillFromAi = vi.fn(async () => true)
    table({ job: staleJob, onRefillFromAi })
    fireEvent.click(screen.getByTestId('ai-check-refill'))
    fireEvent.click(screen.getByTestId('ai-check-refill-cancel'))
    expect(onRefillFromAi).not.toHaveBeenCalled()
    expect(screen.getByTestId('ai-check-refill')).toBeInTheDocument()
  })
})

describe('ReviewTaskTable — «Убрать повторы»', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('повторов нет — кнопки нет', () => {
    table({ duplicateFrames: 0, onRemoveDuplicates: vi.fn(async () => 0) })
    expect(screen.queryByTestId('ai-check-dedupe-frames')).not.toBeInTheDocument()
  })

  it('повторы есть — кнопка с числом, по нажатию убирает', async () => {
    const onRemoveDuplicates = vi.fn(async () => 7)
    table({ duplicateFrames: 7, onRemoveDuplicates })
    const button = screen.getByTestId('ai-check-dedupe-frames')
    expect(button).toHaveTextContent('Убрать повторы (7)')
    fireEvent.click(button)
    await waitFor(() => expect(onRemoveDuplicates).toHaveBeenCalledTimes(1))
  })

  it('§209. Общей кнопки «Перенести рамки» больше нет — решение по каждой находке', () => {
    // Её роль взяли «взять»/«мимо» у каждого предложения: молча тащить все
    // находки на работу — это и был тот мусор, от которого просили избавиться.
    table({
      findings: [{
        id: 'f1', job_id: 'j1', file_id: 'file1', page: 1,
        rect_x: 0.1, rect_y: 0.1, rect_w: 0.2, rect_h: 0.1,
        category: 'calc', text: 'Знак', position: 0,
      }],
    })
    expect(screen.queryByTestId('ai-check-apply-frames')).not.toBeInTheDocument()
  })
})

/**
 * §207. Замер, ради которого всё затевалось: высота блока проверки на работе
 * из 21 задания. Считаем не пиксели (jsdom их не рисует), а строки — то, из
 * чего высота и складывается.
 */
describe('ReviewTaskTable — сколько строк на экране', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('из 21 задания на экране остаются 3 строки и две свёрнутые пачки', () => {
    table()
    expect(screen.queryAllByTestId('review-task-row')).toHaveLength(3)
    expect(screen.getAllByTestId('review-tasks-correct-pack')).toHaveLength(1)
    expect(screen.getAllByTestId('review-tasks-unchecked-pack')).toHaveLength(1)
    cleanup()
  })
})
