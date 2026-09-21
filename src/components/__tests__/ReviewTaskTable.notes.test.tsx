import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import type { AiFindingRow, AiJobRow } from '@/lib/aiHomeworkCheck'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'
import type { ReviewNote } from '@/lib/reviewNotes'

/**
 * §209. Один список вместо двух: замечания живут под строками заданий.
 *
 * Проверяется то, что легко потерять при слиянии: корзина убирает ЗАМЕЧАНИЕ,
 * а не задание; замечаний на задание может быть несколько; находка ИИ —
 * предложение, а не заметка; отказ помнится; расхождение вердикта и
 * замечания подсвечено; пакетное действие трогает только несверенные;
 * клавиатура ставит вердикт одним нажатием.
 */

const job = (over: Partial<AiJobRow> = {}): AiJobRow => ({
  id: 'j1',
  attempt_id: 'a1',
  status: 'done',
  provider: 'openrouter',
  model: 'qwen',
  readable: true,
  suggested_score: 4,
  confidence: 'high',
  summary: 'Разбор',
  last_error: null,
  reference_state: 'used',
  reference_chars: 100,
  worksheet_state: 'used',
  worksheet_chars: 100,
  tasks: [{ no: '1', verdict: 'correct', student_answer: '1', expected_answer: '1', note: '' }],
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

const note = (over: Partial<ReviewNote> & { id: string }): ReviewNote => ({
  taskNo: '13',
  text: 'Ошибка в финальном вычислении',
  page: 2,
  type: 'error',
  categoryLabel: 'Ошибка',
  ...over,
})

const finding = (over: Partial<AiFindingRow> = {}): AiFindingRow => ({
  id: 'f1',
  job_id: 'j1',
  file_id: 'file1',
  page: 2,
  rect_x: 0.1,
  rect_y: 0.1,
  rect_w: 0.2,
  rect_h: 0.1,
  category: 'calc',
  text: 'ошибка в отборе корней',
  position: 0,
  task: '13',
  ...over,
})

function table(over: Partial<React.ComponentProps<typeof ReviewTaskTable>> = {}) {
  return render(
    <ReviewTaskTable
      job={job()}
      findings={[]}
      running={false}
      error={null}
      onRun={() => {}}
      tasks={[row('7', 'correct'), row('13', 'wrong')]}
      gradeScale="five"
      onPatchTask={vi.fn(async () => true)}
      onRemoveTask={vi.fn(async () => true)}
      onAddTask={vi.fn(async () => true)}
      {...over}
    />,
  )
}

const rowByNo = (no: string) =>
  screen.getAllByTestId('review-task-row').find(r => r.dataset.no === no)!

describe('§209 — замечания под строкой задания', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('замечание показывается под своим заданием, с номером страницы', () => {
    table({ notes: [note({ id: 'n1' })] })
    const line = within(rowByNo('13')).getByTestId('review-task-note')
    expect(line).toHaveTextContent('Ошибка в финальном вычислении')
    expect(within(line).getByTestId('review-task-note-page')).toHaveTextContent('стр. 2')
    // У соседнего задания замечаний нет — привязка по номеру, а не «все всем».
    expect(within(rowByNo('7')).queryByTestId('review-task-note')).not.toBeInTheDocument()
  })

  it('на одно задание можно несколько замечаний', () => {
    table({
      notes: [
        note({ id: 'n1', text: 'Ошибка в отборе корней' }),
        note({ id: 'n2', text: 'Арифметика', page: 3 }),
      ],
    })
    expect(within(rowByNo('13')).getAllByTestId('review-task-note')).toHaveLength(2)
  })

  it('корзина удаляет замечание, а не задание', () => {
    const onDeleteNote = vi.fn()
    const onRemoveTask = vi.fn(async () => true)
    table({ notes: [note({ id: 'n1' })], onDeleteNote, onRemoveTask })
    fireEvent.click(within(rowByNo('13')).getByTestId('review-task-note-remove'))
    expect(onDeleteNote).toHaveBeenCalledWith('n1')
    expect(onRemoveTask).not.toHaveBeenCalled()
    // Строка задания на месте.
    expect(rowByNo('13')).toBeInTheDocument()
  })

  it('§212. «стр. N» ведёт к рамке в работе, а клик по тексту открывает правку', () => {
    // До §212 клик по тексту вёл к рамке, а правка пряталась за двойным
    // кликом: два действия на одном слове, и оба угадываются.
    const onFocusNote = vi.fn()
    const onEditNote = vi.fn(async () => true)
    table({ notes: [note({ id: 'n1' })], onFocusNote, onEditNote })
    fireEvent.click(within(rowByNo('13')).getByTestId('review-task-note-page'))
    expect(onFocusNote).toHaveBeenCalledWith('n1')
    fireEvent.click(within(rowByNo('13')).getByTestId('review-task-note-text'))
    expect(within(rowByNo('13')).getByTestId('review-task-note-input')).toBeInTheDocument()
    expect(onFocusNote).toHaveBeenCalledTimes(1)
  })

  it('§212. Enter сохраняет правку, Esc отменяет', () => {
    const onEditNote = vi.fn(async () => true)
    const { unmount } = table({ notes: [note({ id: 'n1' })], onEditNote })
    fireEvent.click(within(rowByNo('13')).getByTestId('review-task-note-text'))
    const input = within(rowByNo('13')).getByTestId('review-task-note-input')
    fireEvent.change(input, { target: { value: 'Потерян второй корень' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onEditNote).toHaveBeenCalledWith('n1', 'Потерян второй корень')
    unmount()

    const second = vi.fn(async () => true)
    table({ notes: [note({ id: 'n1' })], onEditNote: second })
    fireEvent.click(within(rowByNo('13')).getByTestId('review-task-note-text'))
    const again = within(rowByNo('13')).getByTestId('review-task-note-input')
    fireEvent.change(again, { target: { value: 'мимо' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(second).not.toHaveBeenCalled()
  })

  it('«+ Заметка» просит рамку именно для этого задания', () => {
    const onStartNote = vi.fn()
    table({ onStartNote })
    fireEvent.click(within(rowByNo('13')).getByTestId('review-task-add-note'))
    expect(onStartNote).toHaveBeenCalledWith('13')
  })

  it('старое поле note показывается замечанием без места и удаляется в поле', () => {
    const onPatchTask = vi.fn(async () => true)
    table({ tasks: [row('7', 'correct'), row('13', 'wrong', { note: 'старая заметка' })], onPatchTask })
    const line = within(rowByNo('13')).getByTestId('review-task-note')
    expect(line).toHaveTextContent('старая заметка')
    expect(line.dataset.legacy).toBe('true')
    expect(within(line).queryByTestId('review-task-note-page')).not.toBeInTheDocument()
    fireEvent.click(within(line).getByTestId('review-task-note-remove'))
    expect(onPatchTask).toHaveBeenCalledWith('r13', { note: null })
  })

  it('замечание без задания не теряется — отдельным блоком', () => {
    table({ notes: [note({ id: 'n1', taskNo: null, text: 'Подпиши оси' })] })
    expect(screen.getByTestId('review-tasks-orphan-notes')).toHaveTextContent('Подпиши оси')
  })
})

describe('§209 — находки ИИ как предложения', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('находка стоит под своим заданием предложением, а не замечанием', () => {
    table({ findings: [finding()], onTakeFinding: vi.fn(), onSkipFinding: vi.fn() })
    const suggestion = within(rowByNo('13')).getByTestId('ai-finding-suggestion')
    expect(suggestion).toHaveTextContent('ИИ: ошибка в отборе корней')
    // Замечанием она НЕ стала: замечания приходят из рамок, а рамки нет.
    expect(within(rowByNo('13')).queryByTestId('review-task-note')).not.toBeInTheDocument()
  })

  it('«взять» отдаёт находку наружу — там она станет рамкой', async () => {
    const onTakeFinding = vi.fn(async () => true)
    table({ findings: [finding()], onTakeFinding })
    fireEvent.click(within(rowByNo('13')).getByTestId('ai-finding-take'))
    await waitFor(() => expect(onTakeFinding).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' })))
  })

  it('принятая находка предложением больше не висит', () => {
    table({ findings: [finding()], takenFindingIds: ['f1'], onTakeFinding: vi.fn() })
    expect(screen.queryByTestId('ai-finding-suggestion')).not.toBeInTheDocument()
  })

  it('«мимо» убирает предложение и оно не возвращается', async () => {
    const onSkipFinding = vi.fn(async () => true)
    const view = table({ findings: [finding()], onSkipFinding })
    fireEvent.click(within(rowByNo('13')).getByTestId('ai-finding-skip'))
    await waitFor(() => expect(onSkipFinding).toHaveBeenCalled())
    // Отказ помнится снаружи: при следующем открытии работы предложения нет.
    view.rerender(
      <ReviewTaskTable
        job={job()}
        findings={[finding()]}
        dismissedFindings={['f1']}
        running={false}
        error={null}
        onRun={() => {}}
        tasks={[row('7', 'correct'), row('13', 'wrong')]}
        gradeScale="five"
        onPatchTask={vi.fn(async () => true)}
        onSkipFinding={onSkipFinding}
      />,
    )
    expect(screen.queryByTestId('ai-finding-suggestion')).not.toBeInTheDocument()
  })
})

describe('§209 — расхождение вердикта и замечания', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('«верно» и замечание-ошибка — строка подсвечена и подписана', () => {
    table({
      tasks: [row('7', 'correct'), row('13', 'wrong')],
      notes: [note({ id: 'n1', taskNo: '7' })],
    })
    const line = rowByNo('7')
    expect(line.dataset.conflict).toBe('true')
    expect(within(line).getByTestId('review-task-conflict'))
      .toHaveTextContent('вердикт и замечание расходятся')
  })

  it('«верно» и похвала — не расхождение', () => {
    table({
      tasks: [row('7', 'correct'), row('13', 'wrong')],
      notes: [note({ id: 'n1', taskNo: '7', type: 'good', text: 'Аккуратно' })],
    })
    expect(rowByNo('7').dataset.conflict).toBeUndefined()
  })

  it('спорная строка видна и под фильтром «верно»', () => {
    table({
      tasks: [row('1', 'correct'), row('2', 'correct'), row('3', 'correct'), row('4', 'wrong')],
      notes: [note({ id: 'n1', taskNo: '2' })],
    })
    expect(screen.queryAllByTestId('review-task-row').map(r => r.dataset.no)).toContain('2')
    fireEvent.click(screen.getByTestId('review-tasks-filter-correct'))
    expect(screen.queryAllByTestId('review-task-row').map(r => r.dataset.no)).toContain('2')
  })
})

describe('§209 — пакетное действие и клавиатура', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('«Все не сверенные — верные» меняет только несверенные', () => {
    const onBulkVerdict = vi.fn(async () => true)
    table({
      tasks: [row('1', 'wrong'), row('2', 'unchecked'), row('3', 'unchecked'), row('4', 'partial')],
      onBulkVerdict,
    })
    fireEvent.click(screen.getByTestId('review-tasks-bulk-correct'))
    expect(onBulkVerdict).toHaveBeenCalledWith(['r2', 'r3'], 'correct')
  })

  it('одна несверенная — кнопки нет: экономить нечего', () => {
    table({ tasks: [row('1', 'wrong'), row('2', 'unchecked')], onBulkVerdict: vi.fn() })
    expect(screen.queryByTestId('review-tasks-bulk-correct')).not.toBeInTheDocument()
  })

  it('стрелки ходят по строкам, цифра ставит вердикт, Enter заводит замечание', () => {
    const onPatchTask = vi.fn(async () => true)
    const onStartNote = vi.fn()
    table({ tasks: [row('7', 'wrong'), row('13', 'wrong')], onPatchTask, onStartNote })
    const list = screen.getByTestId('review-tasks-list')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(rowByNo('7').dataset.current).toBe('true')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(rowByNo('13').dataset.current).toBe('true')
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onStartNote).toHaveBeenCalledWith('13')
    fireEvent.keyDown(list, { key: '1' })
    expect(onPatchTask).toHaveBeenCalledWith('r13', { verdict: 'correct' })
    fireEvent.keyDown(list, { key: 'Escape' })
    expect(rowByNo('13').dataset.current).toBeUndefined()
  })

  it('§209. Одно нажатие на задание: цифра ставит вердикт и сама идёт вниз', () => {
    // Ради этого клавиатура и заводилась: двадцать заданий — двадцать
    // нажатий, а не сорок кликов «открыть список → выбрать».
    const onPatchTask = vi.fn(async () => true)
    table({ tasks: [row('1', 'unchecked'), row('2', 'unchecked'), row('3', 'unchecked')], onPatchTask })
    const list = screen.getByTestId('review-tasks-list')
    fireEvent.keyDown(list, { key: '1' })
    fireEvent.keyDown(list, { key: '1' })
    fireEvent.keyDown(list, { key: '2' })
    expect(onPatchTask.mock.calls).toEqual([
      ['r1', { verdict: 'correct' }],
      ['r2', { verdict: 'correct' }],
      ['r3', { verdict: 'wrong' }],
    ])
  })
})
