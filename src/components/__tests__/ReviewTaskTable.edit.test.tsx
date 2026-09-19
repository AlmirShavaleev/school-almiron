import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import type { AiJobRow, AiTaskRow } from '@/lib/aiHomeworkCheck'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'

/**
 * §199. Таблица проверки правится преподавателем.
 *
 * Здесь проверяется ровно то, о чём просил владелец: вердикт выпадающим
 * списком, правка заметки и ответов, добавление и удаление строки — и то, что
 * балл считается из ТАБЛИЦЫ ПРЕПОДАВАТЕЛЯ, а не из слепка ИИ.
 */

const AI_TASKS: AiTaskRow[] = [
  { no: '1', verdict: 'correct', student_answer: '12 м/с', expected_answer: '12 м/с', note: '' },
  { no: '2', verdict: 'wrong', student_answer: '−2', expected_answer: '2', note: 'Знак ускорения' },
]

const job = (over: Partial<AiJobRow> = {}): AiJobRow => ({
  id: 'j1',
  attempt_id: 'a1',
  status: 'done',
  provider: 'openrouter',
  model: 'qwen/qwen3-vl-235b-a22b-instruct',
  readable: true,
  suggested_score: 3,
  confidence: 'medium',
  summary: 'Разбор',
  last_error: null,
  reference_state: 'used',
  reference_chars: 4200,
  worksheet_state: 'used',
  worksheet_chars: 900,
  tasks: AI_TASKS,
  dropped_findings: 0,
  accepted_at: null,
  created_at: '2026-09-17T10:00:00Z',
  completed_at: '2026-09-17T10:01:00Z',
  ...over,
})

const row = (over: Partial<ReviewTaskRow> = {}): ReviewTaskRow => ({
  id: 'r1',
  attempt_id: 'a1',
  no: '1',
  verdict: 'correct',
  student_answer: '12 м/с',
  expected_answer: '12 м/с',
  note: null,
  position: 10,
  updated_by: null,
  updated_at: '2026-09-17T10:05:00Z',
  ...over,
})

const LONG_NOTE = 'При торможении знак ускорения противоположен скорости, поэтому в выражении должен стоять минус; в остальном ход решения верный.'

const ROWS: ReviewTaskRow[] = [
  row({ id: 'r1', no: '1', verdict: 'correct' }),
  row({ id: 'r2', no: '2', verdict: 'wrong', student_answer: '−2', expected_answer: '2', note: LONG_NOTE, position: 20 }),
]

function table(over: {
  tasks?: ReviewTaskRow[]
  gradeScale?: 'five' | 'hundred' | null
  onPatchTask?: any
  onAddTask?: any
  onRemoveTask?: any
  onSeedTasks?: any
  saveState?: 'idle' | 'saving' | 'saved' | 'error'
} = {}) {
  const handlers = {
    onPatchTask: over.onPatchTask ?? vi.fn(async () => true),
    onAddTask: over.onAddTask ?? vi.fn(async () => true),
    onRemoveTask: over.onRemoveTask ?? vi.fn(async () => true),
    onSeedTasks: over.onSeedTasks ?? vi.fn(async () => true),
  }
  const view = render(
    <ReviewTaskTable
      job={job()}
      findings={[]}
      running={false}
      error={null}
      onRun={() => {}}
      onApplyFrames={async () => 0}
      tasks={over.tasks ?? ROWS}
      gradeScale={over.gradeScale ?? 'five'}
      saveState={over.saveState ?? 'idle'}
      {...handlers}
    />,
  )
  return { ...view, ...handlers }
}

const rowByNo = (no: string) =>
  screen.getAllByTestId('review-task-row').find(r => r.dataset.no === no)!

describe('ReviewTaskTable — правка таблицы', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('§207. Вердикт — компактная кнопка, список из четырёх значений по клику', () => {
    table()
    const trigger = within(rowByNo('2')).getByTestId('review-task-verdict')
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger).toHaveTextContent('неверно')
    // Закрытый список не занимает места и не держит слово целиком.
    expect(screen.queryByTestId('review-task-verdict-menu')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    const menu = screen.getByTestId('review-task-verdict-menu')
    expect(within(menu).getAllByRole('option').map(o => o.textContent)).toEqual([
      'верно', 'неверно', 'частично', 'не сверено',
    ])
  })

  it('смена вердикта сохраняется сразу', () => {
    const { onPatchTask } = table()
    fireEvent.click(within(rowByNo('2')).getByTestId('review-task-verdict'))
    fireEvent.click(screen.getByTestId('review-task-verdict-option-partial'))
    expect(onPatchTask).toHaveBeenCalledWith('r2', { verdict: 'partial' })
    // Выбор закрывает список — иначе он перекрывает соседние строки.
    expect(screen.queryByTestId('review-task-verdict-menu')).not.toBeInTheDocument()
  })

  it('сводка и балл считаются по таблице преподавателя, а не по слепку ИИ', () => {
    // Слепок ИИ: 1 верно + 1 неверно → 3. Таблица преподавателя: три строки,
    // из них две верные и одна частичная → (2 + 0,5)/3 = 0,83 → 4.
    table({
      tasks: [
        row({ id: 'r1', no: '1', verdict: 'correct' }),
        row({ id: 'r2', no: '2', verdict: 'correct', position: 20 }),
        row({ id: 'r3', no: '3', verdict: 'partial', position: 30 }),
      ],
    })
    const summary = screen.getByTestId('ai-check-tasks-summary')
    expect(summary).toHaveTextContent('верно 2')
    expect(summary).toHaveTextContent('частично 1')
    expect(screen.getByTestId('ai-check-tasks-score')).toHaveTextContent('4')
    // Балл ИИ при этом остался своим и не подменён таблицей.
    expect(screen.getByTestId('ai-check-score')).toHaveTextContent('3')
  })

  it('все несверены — балла из таблицы нет: ноль вслепую хуже отсутствия', () => {
    table({ tasks: [row({ id: 'r1', no: '1', verdict: 'unchecked' })] })
    expect(screen.getByTestId('ai-check-tasks-summary')).toHaveTextContent('не сверено 1')
    expect(screen.queryByTestId('ai-check-tasks-score')).not.toBeInTheDocument()
  })

  it('заметка сохраняется по уходу из поля, а не на каждую букву', () => {
    // Верных в этой таблице одна — порог свёртки (три) не сработал, строка
    // видна сразу.
    const { onPatchTask } = table()
    expect(screen.queryByTestId('review-tasks-correct-pack')).not.toBeInTheDocument()
    const note = within(rowByNo('1')).getByTestId('review-task-note')
    fireEvent.change(note, { target: { value: 'Проверь единицы' } })
    expect(onPatchTask).not.toHaveBeenCalled()
    fireEvent.blur(note)
    expect(onPatchTask).toHaveBeenCalledWith('r1', { note: 'Проверь единицы' })
  })

  it('пустая заметка уходит как null, а не пустой строкой', () => {
    const { onPatchTask } = table()
    const note = within(rowByNo('2')).getByTestId('review-task-note')
    fireEvent.change(note, { target: { value: '   ' } })
    fireEvent.blur(note)
    expect(onPatchTask).toHaveBeenCalledWith('r2', { note: null })
  })

  it('заметка без правки ничего не пишет: уход из поля — не изменение', () => {
    const { onPatchTask } = table()
    const note = within(rowByNo('2')).getByTestId('review-task-note')
    fireEvent.focus(note)
    fireEvent.blur(note)
    expect(onPatchTask).not.toHaveBeenCalled()
  })

  it('длинная заметка свёрнута в одну строку, в фокусе разворачивается', () => {
    table()
    const note = within(rowByNo('2')).getByTestId('review-task-note') as HTMLTextAreaElement
    expect(note.rows).toBe(1)
    fireEvent.focus(note)
    expect((within(rowByNo('2')).getByTestId('review-task-note') as HTMLTextAreaElement).rows).toBe(3)
  })

  it('ответ ученика и ожидаемый ответ правятся', () => {
    const { onPatchTask } = table()
    const line = within(rowByNo('2'))
    fireEvent.change(line.getByTestId('review-task-student-answer'), { target: { value: '-2 м/с²' } })
    fireEvent.blur(line.getByTestId('review-task-student-answer'))
    fireEvent.change(line.getByTestId('review-task-expected-answer'), { target: { value: '2 м/с²' } })
    fireEvent.blur(line.getByTestId('review-task-expected-answer'))
    expect(onPatchTask).toHaveBeenNthCalledWith(1, 'r2', { student_answer: '-2 м/с²' })
    expect(onPatchTask).toHaveBeenNthCalledWith(2, 'r2', { expected_answer: '2 м/с²' })
  })

  it('номер задания правится: модель нумерует не всегда как в работе', () => {
    const { onPatchTask } = table()
    const no = within(rowByNo('2')).getByTestId('review-task-no')
    fireEvent.change(no, { target: { value: '2a' } })
    fireEvent.blur(no)
    expect(onPatchTask).toHaveBeenCalledWith('r2', { no: '2a' })
  })

  it('пустой номер не сохраняется — строка без номера не строка', () => {
    const { onPatchTask } = table()
    const no = within(rowByNo('2')).getByTestId('review-task-no')
    fireEvent.change(no, { target: { value: '  ' } })
    fireEvent.blur(no)
    expect(onPatchTask).not.toHaveBeenCalled()
  })

  it('§207. Плейсхолдера у заметки нет — пустое поле молчит', () => {
    table()
    expect(within(rowByNo('2')).getByTestId('review-task-note')).not.toHaveAttribute('placeholder')
  })

  it('строку можно добавить и удалить', () => {
    const { onAddTask, onRemoveTask } = table()
    fireEvent.click(screen.getByTestId('review-tasks-add'))
    expect(onAddTask).toHaveBeenCalled()
    fireEvent.click(within(rowByNo('2')).getByTestId('review-task-remove'))
    expect(onRemoveTask).toHaveBeenCalledWith('r2')
  })

  it('«Сохранено» показывается после записи, «Сохраняю» — во время', () => {
    const { unmount } = table({ saveState: 'saving' })
    expect(screen.getByTestId('review-tasks-save-state')).toHaveTextContent('Сохраняю')
    unmount()
    table({ saveState: 'saved' })
    expect(screen.getByTestId('review-tasks-save-state')).toHaveTextContent('Сохранено')
  })

  it('своей таблицы ещё нет — слепок ИИ для чтения и кнопка «Взять таблицу ИИ»', () => {
    const { onSeedTasks } = table({ tasks: [] })
    expect(screen.getAllByTestId('ai-task-row')).toHaveLength(2)
    expect(screen.queryByTestId('review-task-row')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('review-tasks-seed'))
    expect(onSeedTasks).toHaveBeenCalled()
  })
})
