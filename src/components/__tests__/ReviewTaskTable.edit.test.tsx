import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import type { AiJobRow, AiTaskRow } from '@/lib/aiHomeworkCheck'
import type { ReviewTaskRow } from '@/lib/homeworkReviewTasks'

/**
 * §199 + §209. Таблица проверки — единственный список экрана.
 *
 * Что здесь проверяется: вердикт ставится кликом, номер и ответы НЕ правятся
 * (это справка из слепка модели), ожидаемый печатается только при настоящем
 * расхождении, «убрать задание» уехало в неприметное меню, а балл считается
 * из таблицы преподавателя, а не из слепка ИИ.
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

function table(over: Partial<React.ComponentProps<typeof ReviewTaskTable>> = {}) {
  const handlers = {
    onPatchTask: (over.onPatchTask ?? vi.fn(async () => true)) as any,
    onAddTask: (over.onAddTask ?? vi.fn(async () => true)) as any,
    onRemoveTask: (over.onRemoveTask ?? vi.fn(async () => true)) as any,
    onSeedTasks: (over.onSeedTasks ?? vi.fn(async () => true)) as any,
  }
  const view = render(
    <ReviewTaskTable
      job={job()}
      findings={[]}
      running={false}
      error={null}
      onRun={() => {}}
      tasks={ROWS}
      gradeScale="five"
      saveState="idle"
      {...over}
      {...handlers}
    />,
  )
  return { ...view, ...handlers }
}

const rowByNo = (no: string) =>
  screen.getAllByTestId('review-task-row').find(r => r.dataset.no === no)!

describe('ReviewTaskTable — правка таблицы', () => {
  beforeEach(() => { sessionStorage.clear() })

  it('§209/§214. Вердикт — значок без слова, список из пяти по клику', () => {
    table()
    const trigger = within(rowByNo('2')).getByTestId('review-task-verdict')
    expect(trigger.tagName).toBe('BUTTON')
    // Слова в закрытом состоянии нет: восемь «верно» подряд — колонна шума.
    expect(trigger).not.toHaveTextContent('неверно')
    expect(trigger).toHaveAttribute('aria-label', 'Вердикт задания 2: неверно')
    expect(screen.queryByTestId('review-task-verdict-menu')).not.toBeInTheDocument()
    fireEvent.click(trigger)
    const menu = screen.getByTestId('review-task-verdict-menu')
    // §214: пятым стало «не решено» — оно отделилось от «не сверено».
    expect(within(menu).getAllByRole('option').map(o => o.textContent)).toEqual([
      'верно', 'неверно', 'частично', 'не сверено', 'не решено',
    ])
  })

  it('смена вердикта сохраняется сразу', () => {
    const { onPatchTask } = table()
    fireEvent.click(within(rowByNo('2')).getByTestId('review-task-verdict'))
    fireEvent.click(screen.getByTestId('review-task-verdict-option-partial'))
    expect(onPatchTask).toHaveBeenCalledWith('r2', { verdict: 'partial' })
    expect(screen.queryByTestId('review-task-verdict-menu')).not.toBeInTheDocument()
  })

  it('§212. Список закрывается по Esc и кликом вне', () => {
    table()
    const trigger = within(rowByNo('2')).getByTestId('review-task-verdict')
    fireEvent.click(trigger)
    expect(screen.getByTestId('review-task-verdict-menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('review-task-verdict-menu')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    expect(screen.getByTestId('review-task-verdict-menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('review-task-verdict-menu')).not.toBeInTheDocument()
  })

  it('§212. Список живёт в body — прокрутка колонки его не обрежет', () => {
    // С §210 таблица стоит в своей прокручиваемой колонке: список, нарисованный
    // внутри строки, у нижних заданий обрезался её краем.
    table()
    fireEvent.click(within(rowByNo('2')).getByTestId('review-task-verdict'))
    const menu = screen.getByTestId('review-task-verdict-menu')
    expect(menu.closest('[data-testid="review-tasks-list"]')).toBeNull()
    expect(menu.parentElement).toBe(document.body)
  })

  it('§212. Прокрутка колонки список не закрывает — он едет за кружком', () => {
    // Закрывать по любому колесу нельзя: браузер сам прокручивает колонку,
    // наводя фокус на выбранный вариант, и список схлопывался бы при открытии.
    table()
    fireEvent.click(within(rowByNo('2')).getByTestId('review-task-verdict'))
    fireEvent.scroll(window)
    expect(screen.getByTestId('review-task-verdict-menu')).toBeInTheDocument()
  })

  it('§212. Кружок уехал за край окна — список закрывается', () => {
    table()
    const trigger = within(rowByNo('2')).getByTestId('review-task-verdict')
    fireEvent.click(trigger)
    expect(screen.getByTestId('review-task-verdict-menu')).toBeInTheDocument()
    trigger.getBoundingClientRect = () => ({ top: -120, bottom: -96, left: 0, right: 24 }) as DOMRect
    fireEvent.scroll(window)
    expect(screen.queryByTestId('review-task-verdict-menu')).not.toBeInTheDocument()
  })

  it('§209/§212. Клавиши 1–4 ставят вердикт без открытия списка', () => {
    const { onPatchTask } = table()
    const list = screen.getByTestId('review-tasks-list')
    fireEvent.keyDown(list, { key: '2' })
    expect(onPatchTask).toHaveBeenCalledWith('r1', { verdict: 'wrong' })
    expect(screen.queryByTestId('review-task-verdict-menu')).not.toBeInTheDocument()
  })

  it('сводка и балл считаются по таблице преподавателя, а не по слепку ИИ', () => {
    table({
      tasks: [
        row({ id: 'r1', no: '1', verdict: 'correct' }),
        row({ id: 'r2', no: '2', verdict: 'correct', position: 20 }),
        row({ id: 'r3', no: '3', verdict: 'partial', position: 30 }),
      ],
    })
    expect(screen.getByTestId('review-tasks-filter-correct')).toHaveTextContent('2 верно')
    expect(screen.getByTestId('review-tasks-filter-partial')).toHaveTextContent('1 частично')
    expect(screen.getByTestId('ai-check-tasks-score')).toHaveTextContent('4')
    expect(screen.getByTestId('ai-check-score')).toHaveTextContent('3')
  })

  it('все несверены — балла из таблицы нет: ноль вслепую хуже отсутствия', () => {
    table({ tasks: [row({ id: 'r1', no: '1', verdict: 'unchecked' })] })
    expect(screen.getByTestId('review-tasks-filter-unchecked')).toHaveTextContent('1 не сверено')
    expect(screen.queryByTestId('ai-check-tasks-score')).not.toBeInTheDocument()
  })

  it('§209. Номер и ответы — справка, полей ввода в строке нет', () => {
    table()
    expect(screen.queryByTestId('review-task-no')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-task-student-answer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-task-expected-answer')).not.toBeInTheDocument()
    expect(rowByNo('2')).toHaveTextContent('2')
  })

  it('§209. Ожидаемый печатается только при расхождении', () => {
    table({
      tasks: [
        row({ id: 'r1', no: '1', student_answer: '12 м/с', expected_answer: '12 м/с' }),
        row({ id: 'r2', no: '2', student_answer: '12', expected_answer: '30', position: 20 }),
      ],
    })
    expect(within(rowByNo('1')).getByTestId('review-task-answers')).toHaveTextContent(/^12 м\/с$/)
    expect(within(rowByNo('2')).getByTestId('review-task-answers')).toHaveTextContent('30')
  })

  it('§209. «3,5» и «3.5», «−2» и «-2» — одно и то же, расхождения нет', () => {
    table({
      tasks: [
        row({ id: 'r1', no: '1', student_answer: '3,5', expected_answer: '3.5' }),
        row({ id: 'r2', no: '2', student_answer: '−2', expected_answer: '-2', position: 20 }),
      ],
    })
    expect(within(rowByNo('1')).getByTestId('review-task-answers')).toHaveTextContent(/^3,5$/)
    expect(within(rowByNo('2')).getByTestId('review-task-answers')).toHaveTextContent(/^−2$/)
  })

  it('§209. Эталона нет — прочерк, а не пустое поле', () => {
    table({ tasks: [row({ id: 'r1', no: '1', student_answer: '12', expected_answer: null })] })
    expect(within(rowByNo('1')).getByTestId('review-task-answers')).toHaveTextContent('—')
  })

  it('§209. Ни ответа, ни эталона — один прочерк', () => {
    table({ tasks: [row({ id: 'r1', no: '1', student_answer: null, expected_answer: null })] })
    expect(within(rowByNo('1')).getByTestId('review-task-answers')).toHaveTextContent(/^—$/)
  })

  it('задание добавляется кнопкой, убирается из неприметного меню строки', () => {
    const { onAddTask, onRemoveTask } = table()
    fireEvent.click(screen.getByTestId('review-tasks-add'))
    expect(onAddTask).toHaveBeenCalled()
    // Пока меню не открыто, «убрать задание» на экране нет: действие редкое и
    // за внимание со статусами бороться не должно.
    expect(screen.queryByTestId('review-task-remove')).not.toBeInTheDocument()
    fireEvent.click(within(rowByNo('2')).getByTestId('review-task-menu'))
    fireEvent.click(screen.getByTestId('review-task-remove'))
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
