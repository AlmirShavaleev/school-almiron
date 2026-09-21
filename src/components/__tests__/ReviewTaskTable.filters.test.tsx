import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import type { AiJobRow, AiTaskRow } from '@/lib/aiHomeworkCheck'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'

/**
 * §212. Счётчики стали фильтрами, а свёртки §207 (пачка верных и пачка
 * одинаковых «не сверено») убраны совсем: две механики для одной задачи и
 * делали экран кашей.
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

/** 21 задание: 13 верных, 2 неверных, 1 частично, 5 «не сверено». */
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
const chip = (kind: string) => screen.getByTestId(`review-tasks-filter-${kind}`)

describe('ReviewTaskTable — счётчики-фильтры', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('по умолчанию видны все двадцать одно задание', () => {
    table()
    expect(visibleNos()).toHaveLength(21)
    expect(chip('all')).toHaveAttribute('aria-pressed', 'true')
  })

  it('счётчики показывают, сколько заданий в каждом состоянии', () => {
    table()
    expect(chip('correct')).toHaveTextContent('13 верно')
    expect(chip('wrong')).toHaveTextContent('2 неверно')
    expect(chip('partial')).toHaveTextContent('1 частично')
    expect(chip('unchecked')).toHaveTextContent('5 не сверено')
  })

  it('нажатие на «неверно» оставляет только неверные', () => {
    table()
    fireEvent.click(chip('wrong'))
    expect(visibleNos()).toEqual(['14', '15'])
    expect(chip('wrong')).toHaveAttribute('aria-pressed', 'true')
  })

  it('фильтр по каждому состоянию', () => {
    table()
    fireEvent.click(chip('correct'))
    expect(visibleNos()).toHaveLength(13)
    fireEvent.click(chip('partial'))
    expect(visibleNos()).toEqual(['16'])
    fireEvent.click(chip('unchecked'))
    expect(visibleNos()).toEqual(['17', '18', '19', '20', '21'])
  })

  it('повторное нажатие возвращает все', () => {
    table()
    fireEvent.click(chip('wrong'))
    fireEvent.click(chip('wrong'))
    expect(visibleNos()).toHaveLength(21)
  })

  it('«все» возвращает все', () => {
    table()
    fireEvent.click(chip('unchecked'))
    expect(visibleNos()).toHaveLength(5)
    fireEvent.click(chip('all'))
    expect(visibleNos()).toHaveLength(21)
  })

  it('счётчик с нулём выключен — кнопка, после которой список пуст, обманывает', () => {
    table({ tasks: [row('1', 'correct'), row('2', 'wrong')] })
    expect(chip('partial')).toBeDisabled()
    expect(chip('unchecked')).toBeDisabled()
    expect(chip('correct')).not.toBeDisabled()
    fireEvent.click(chip('partial'))
    expect(visibleNos()).toEqual(['1', '2'])
  })

  it('под фильтром, где строк не осталось, — честная строка вместо пустоты', () => {
    // Такое бывает после смены вердикта: фильтр «частично» включён, а
    // единственное «частично» стало верным.
    const { rerender } = table({ tasks: [row('1', 'partial'), row('2', 'wrong')] })
    fireEvent.click(chip('partial'))
    expect(visibleNos()).toEqual(['1'])
    rerender(
      <ReviewTaskTable
        job={job()}
        findings={[]}
        running={false}
        error={null}
        onRun={() => {}}
        tasks={[row('1', 'correct'), row('2', 'wrong')]}
        gradeScale="five"
        onPatchTask={vi.fn(async () => true)}
      />,
    )
    expect(visibleNos()).toHaveLength(0)
    expect(screen.getByTestId('review-tasks-empty')).toHaveTextContent('Заданий с таким состоянием нет')
  })

  it('балл стоит в той же полосе', () => {
    table()
    expect(within(screen.getByTestId('review-tasks-filters')).getByTestId('ai-check-tasks-score'))
      .toHaveTextContent('балл 4')
  })

  it('§212. Свёрток §207 больше нет: ни пачки верных, ни пачки «не сверено»', () => {
    table()
    expect(screen.queryByTestId('review-tasks-correct-pack')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-tasks-correct-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-tasks-unchecked-pack')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-tasks-unchecked-toggle')).not.toBeInTheDocument()
  })

  it('клавиши 1–4 ходят по видимым строкам фильтра, список статусов для этого не нужен', () => {
    const onPatchTask = vi.fn(async () => true)
    table({ onPatchTask })
    fireEvent.click(chip('wrong'))
    const list = screen.getByTestId('review-tasks-list')
    expect(screen.queryByTestId('review-task-verdict-menu')).not.toBeInTheDocument()
    fireEvent.keyDown(list, { key: '1' })
    fireEvent.keyDown(list, { key: '3' })
    expect(onPatchTask.mock.calls).toEqual([
      ['r14', { verdict: 'correct' }],
      ['r15', { verdict: 'partial' }],
    ])
    expect(screen.queryByTestId('review-task-verdict-menu')).not.toBeInTheDocument()
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
 * §212. Замер, ради которого всё затевалось. Считаем не пиксели (jsdom их не
 * рисует), а то, из чего высота складывается: строки и вторые строки под
 * ними.
 */
describe('ReviewTaskTable — сколько строк на экране', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('все 21 видны, но вторая строка есть только у восьми — тех, где есть что сказать', () => {
    table()
    expect(screen.queryAllByTestId('review-task-row')).toHaveLength(21)
    // Легаси-заметки есть у 14, 15, 16 и пяти «не сверено» — восемь строк.
    expect(screen.queryAllByTestId('review-task-under')).toHaveLength(8)
    cleanup()
  })

  it('у верного задания без замечаний второй строки нет вовсе', () => {
    table({ tasks: [row('1', 'correct', { student_answer: '12', expected_answer: '12' })] })
    const line = screen.getByTestId('review-task-row')
    expect(within(line).queryByTestId('review-task-under')).not.toBeInTheDocument()
    expect(within(line).queryByTestId('review-task-note')).not.toBeInTheDocument()
  })

  it('§212. Рамок в строке ноль — рамка одна, у панели', () => {
    table({ tasks: [row('2', 'wrong', { student_answer: '12', expected_answer: '30' })] })
    const line = screen.getByTestId('review-task-row')
    expect(line.querySelectorAll('input, textarea, select')).toHaveLength(0)
  })
})

describe('ReviewTaskTable — подсветка строки', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('ответ разошёлся с эталоном — строка помечена расхождением', () => {
    table({ tasks: [row('1', 'partial', { student_answer: '12', expected_answer: '30' })] })
    expect(screen.getByTestId('review-task-row').dataset.tone).toBe('mismatch')
  })

  it('ответы сошлись и вердикт «верно» — строка не подсвечена', () => {
    table({ tasks: [row('1', 'correct', { student_answer: '3,5', expected_answer: '3.5' })] })
    expect(screen.getByTestId('review-task-row').dataset.tone).toBe('none')
  })

  it('эталона нет — это не расхождение, а отсутствие сведений', () => {
    table({ tasks: [row('1', 'correct', { student_answer: '12', expected_answer: null })] })
    expect(screen.getByTestId('review-task-row').dataset.tone).toBe('none')
  })

  it('спор вердикта с замечанием — своя подсветка, и она сильнее расхождения', () => {
    table({
      tasks: [row('1', 'correct', { student_answer: '500', expected_answer: '500' })],
      notes: [{
        id: 'n1', taskNo: '1', text: 'Ответ совпадает, но ход неверен',
        page: 3, type: 'error', categoryLabel: 'Ошибка',
      }],
    })
    expect(screen.getByTestId('review-task-row').dataset.tone).toBe('conflict')
  })
})
