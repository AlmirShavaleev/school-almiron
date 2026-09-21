import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import {
  aiTasksOf,
  findingsOfTask,
  summarizeTasks,
  taskNoFromText,
  taskNoOfFinding,
  type AiFindingRow,
  type AiJobRow,
  type AiTaskRow,
} from '@/lib/aiHomeworkCheck'

/**
 * §186. Таблица по заданиям в панели ИИ.
 *
 * Проверяем ровно то, ради чего блок заведён: порядок строк модели, честную
 * сводку, связь строки с находкой — и молчание на проверках старее v17, где
 * таблицы нет (их в базе три десятка, и панель обязана выглядеть как раньше).
 */

const task = (over: Partial<AiTaskRow> = {}): AiTaskRow => ({
  no: '1',
  verdict: 'correct',
  student_answer: '5',
  expected_answer: '5',
  note: '',
  ...over,
})

const TASKS: AiTaskRow[] = [
  task({ no: '3', verdict: 'wrong', student_answer: '12 м/с', expected_answer: '8 м/с', note: 'Знак ускорения' }),
  task({ no: '1', verdict: 'correct' }),
  task({ no: '2', verdict: 'partial', student_answer: '30', expected_answer: '30', note: 'Нет хода решения' }),
  task({ no: '4', verdict: 'unchecked', student_answer: '', expected_answer: '', note: 'Не разобрал почерк' }),
]

const finding = (over: Partial<AiFindingRow> = {}): AiFindingRow => ({
  id: 'f1',
  job_id: 'j1',
  file_id: 'file1',
  page: 1,
  rect_x: 0.1,
  rect_y: 0.2,
  rect_w: 0.3,
  rect_h: 0.1,
  category: 'calc',
  text: 'В задаче 3 знак ускорения при торможении отрицательный.',
  position: 0,
  ...over,
})

const FINDINGS: AiFindingRow[] = [
  finding(),
  finding({ id: 'f2', category: 'logic', text: 'Задание 2: ответ верный, но хода решения нет.', position: 1 }),
  finding({ id: 'f3', category: 'format', text: 'Нет единиц измерения.', position: 2 }),
]

const job = (over: Partial<AiJobRow> = {}): AiJobRow => ({
  id: 'j1',
  attempt_id: 'a1',
  status: 'done',
  provider: 'openrouter',
  model: 'qwen/qwen3-vl-235b-a22b-instruct',
  readable: true,
  suggested_score: 4,
  confidence: 'medium',
  summary: 'Разбор',
  last_error: null,
  reference_state: 'used',
  reference_chars: 4200,
  worksheet_state: 'used',
  worksheet_chars: 900,
  tasks: TASKS,
  dropped_findings: 0,
  accepted_at: null,
  created_at: '2026-09-16T10:00:00Z',
  completed_at: '2026-09-16T10:01:00Z',
  ...over,
})

const panel = (over: Partial<AiJobRow> = {}, findings: AiFindingRow[] = FINDINGS) => render(
  <ReviewTaskTable
    job={job(over)}
    findings={findings}
    running={false}
    error={null}
    onRun={() => {}}
  />,
)

describe('aiTasksOf', () => {
  it('таблицы нет — null, и панели нечего рисовать', () => {
    expect(aiTasksOf(job({ tasks: null }))).toBeNull()
    expect(aiTasksOf(job({ tasks: undefined }))).toBeNull()
    expect(aiTasksOf(job({ tasks: [] }))).toBeNull()
  })

  it('проверка ещё идёт — таблицы не показываем', () => {
    expect(aiTasksOf(job({ status: 'processing' }))).toBeNull()
  })

  it('кривая строка выбрасывается, а не роняет разбор', () => {
    const rows = aiTasksOf(job({
      tasks: [
        { no: '', verdict: 'wrong' } as AiTaskRow,
        { no: '2' } as AiTaskRow,
        task({ no: '3', verdict: 'wrong' }),
      ],
    }))
    expect(rows?.map(r => [r.no, r.verdict])).toEqual([['2', 'unchecked'], ['3', 'wrong']])
  })
})

describe('summarizeTasks', () => {
  it('считает по вердиктам, включая несверенные', () => {
    expect(summarizeTasks(TASKS)).toEqual({ correct: 1, wrong: 1, partial: 1, unchecked: 1, total: 4 })
  })
})

describe('taskNoFromText / findingsOfTask', () => {
  it('достаёт номер задания из текста находки', () => {
    expect(taskNoFromText('В задаче 3 знак ускорения')).toBe('3')
    expect(taskNoFromText('Задание 12: проверьте вычисления')).toBe('12')
    expect(taskNoFromText('№ 7 — нет единиц')).toBe('7')
    expect(taskNoFromText('Нет единиц измерения.')).toBe('')
  })

  it('находки строки — по её номеру', () => {
    expect(findingsOfTask(FINDINGS, '3').map(f => f.id)).toEqual(['f1'])
    expect(findingsOfTask(FINDINGS, '4')).toEqual([])
  })
})

/**
 * §192. Номер задания у находки приходит столбцом `task` — его пишет сама
 * функция из своей же таблицы. Текст остаётся запасным путём: проверок,
 * сделанных до §192, в базе несколько десятков, и у них столбец пуст.
 */
describe('taskNoOfFinding — столбец задания у находки (§192)', () => {
  it('номер берётся из столбца, даже когда в тексте его нет', () => {
    const f = finding({ id: 'c1', task: '3', text: 'Знак ускорения при торможении отрицательный.' })
    expect(taskNoOfFinding(f)).toBe('3')
    expect(findingsOfTask([f], '3').map(x => x.id)).toEqual(['c1'])
  })

  it('столбец записан по-разному — «№ 4», «4.» — и всё равно та же строка', () => {
    expect(taskNoOfFinding(finding({ task: '№ 4', text: 'Нет единиц.' }))).toBe('4')
    expect(taskNoOfFinding(finding({ task: '4.', text: 'Нет единиц.' }))).toBe('4')
  })

  it('столбца нет (проверка старее §192) — работает старое правило по тексту', () => {
    expect(taskNoOfFinding(finding({ task: null }))).toBe('3')
    expect(taskNoOfFinding(finding({ task: '' }))).toBe('3')
    const legacy = finding({ id: 'l1' })
    delete legacy.task
    expect(taskNoOfFinding(legacy)).toBe('3')
    expect(findingsOfTask([legacy], '3').map(x => x.id)).toEqual(['l1'])
  })

  it('столбец спорит с текстом — верим столбцу: это данные, а не догадка', () => {
    expect(taskNoOfFinding(finding({ task: '5', text: 'В задаче 3 знак ускорения' }))).toBe('5')
  })

  it('ни столбца, ни номера в тексте — находка ничьей строке не принадлежит', () => {
    const f = finding({ id: 'n1', task: null, text: 'Нет единиц измерения.' })
    expect(taskNoOfFinding(f)).toBe('')
    expect(findingsOfTask([f], '3')).toEqual([])
    expect(findingsOfTask([f], '')).toEqual([])
  })
})

describe('ReviewTaskTable — слепок ИИ в блоке «По заданиям»', () => {
  it('строки идут в порядке ответа модели', () => {
    panel()
    const rows = screen.getAllByTestId('ai-task-row')
    expect(rows.map(r => r.dataset.no)).toEqual(['3', '1', '2', '4'])
  })

  it('счётчики считают вердикты и показывают балл, из которого они сложились', () => {
    panel()
    expect(screen.getByTestId('review-tasks-filter-correct')).toHaveTextContent('1 верно')
    expect(screen.getByTestId('review-tasks-filter-wrong')).toHaveTextContent('1 неверно')
    expect(screen.getByTestId('review-tasks-filter-partial')).toHaveTextContent('1 частично')
    expect(screen.getByTestId('review-tasks-filter-unchecked')).toHaveTextContent('1 не сверено')
    expect(screen.getByTestId('ai-check-tasks-score')).toHaveTextContent('4')
  })

  it('несверенное задание видно и в сводке, и в списке строк', () => {
    panel()
    const unchecked = screen.getAllByTestId('ai-task-row').filter(r => r.dataset.verdict === 'unchecked')
    expect(unchecked).toHaveLength(1)
    expect(unchecked[0]).toHaveTextContent('не сверено')
    expect(unchecked[0]).toHaveTextContent('Не разобрал почерк')
  })

  it('ответ ученика и ожидаемый — в одной строке', () => {
    panel()
    const wrong = screen.getAllByTestId('ai-task-row').find(r => r.dataset.verdict === 'wrong')!
    expect(wrong).toHaveTextContent('12 м/с')
    expect(wrong).toHaveTextContent('8 м/с')
  })

  it('слепок править нельзя: ни списков вердикта, ни удаления строк', () => {
    // §180: `topic_homework_ai_jobs.tasks` — измерение, а не черновик. Пока
    // своей таблицы нет, блок только читается.
    panel()
    expect(screen.queryAllByTestId('review-task-verdict')).toHaveLength(0)
    expect(screen.queryAllByTestId('review-task-remove')).toHaveLength(0)
  })

  it('§199 + §209. Отдельного списка находок нет, и общего переноса рамок тоже', () => {
    panel()
    expect(screen.queryAllByTestId('ai-check-finding')).toHaveLength(0)
    // §209: решение принимается по каждой находке отдельно — «взять»/«мимо».
    expect(screen.queryByTestId('ai-check-apply-frames')).not.toBeInTheDocument()
  })

  it('§199. Заметка слепка видна под строкой', () => {
    panel()
    const wrong = screen.getAllByTestId('ai-task-row').find(r => r.dataset.verdict === 'wrong')!
    expect(wrong).toHaveTextContent('Знак ускорения')
  })

  it('§207. «Вставить в комментарий» пережила блок «Резюме ИИ»', () => {
    // Разбор с экрана ушёл, а вернуть его в комментарий по-прежнему бывает
    // нужно: преподаватель стёр текст — без кнопки это тупик.
    const onUseText = vi.fn()
    render(
      <ReviewTaskTable
        job={job()}
        findings={FINDINGS}
        running={false}
        error={null}
        onRun={() => {}}
        onUseText={onUseText}
      />,
    )
    fireEvent.click(screen.getByTestId('ai-check-use-text'))
    expect(onUseText).toHaveBeenCalledWith('Разбор')
  })

  it('§207. Обработчика вставки нет — нет и кнопки', () => {
    panel()
    expect(screen.queryByTestId('ai-check-use-text')).not.toBeInTheDocument()
  })

  it('§207. Счётчик на экране один — табличный; второго ряда от ИИ нет', () => {
    panel()
    expect(screen.getByTestId('review-tasks-filters')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-check-summary-counts')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-check-summary-toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-check-summary')).not.toBeInTheDocument()
  })

  it('§207. Имени модели и слов про уверенность на экране нет', () => {
    const { container } = panel()
    expect(screen.queryByTestId('ai-check-model')).not.toBeInTheDocument()
    expect(container.textContent).not.toContain('qwen')
    expect(container.textContent).not.toMatch(/уверенность/i)
  })

  it('§207. Пояснений на экране нет, но под знаком вопроса они есть', () => {
    const { container } = panel()
    expect(container.textContent).not.toContain('может ошибиться')
    expect(container.textContent).not.toContain('Клавиши')
    fireEvent.click(screen.getByTestId('ai-check-hint-toggle'))
    const hint = screen.getByTestId('ai-check-hint')
    expect(hint).toHaveTextContent('может ошибиться')
    expect(hint).toHaveTextContent('Клавиши')
  })

  it('при низкой уверенности балл в полосе счётчиков молчит, как и в шапке', () => {
    panel({ confidence: 'low' })
    expect(screen.getByTestId('review-tasks-filters')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-check-tasks-score')).not.toBeInTheDocument()
  })
})

describe('ReviewTaskTable — проверка старее v17', () => {
  it('без таблицы блока нет, а панель работает как раньше', () => {
    panel({ tasks: null })
    expect(screen.queryByTestId('ai-check-tasks')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-check-run')).toBeInTheDocument()
  })

  it('столбца tasks в строке нет вовсе — тоже без блока и без падения', () => {
    const legacy = job()
    delete legacy.tasks
    render(
      <ReviewTaskTable job={legacy} findings={FINDINGS} running={false} error={null} onRun={() => {}} />,
    )
    expect(screen.queryByTestId('ai-check-tasks')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-check-panel')).toBeInTheDocument()
  })
})

/**
 * §207. Отброшенные находки — измерение качества модели, а не рабочая
 * информация преподавателя. С экрана строка ушла под знак вопроса, но не
 * пропала: число там по-прежнему честное и склоняется.
 */
describe('ReviewTaskTable — отброшенные находки', () => {
  const openHint = () => fireEvent.click(screen.getByTestId('ai-check-hint-toggle'))

  it('на экране строки нет — она под знаком вопроса', () => {
    const { container } = panel({ dropped_findings: 3 })
    expect(container.textContent).not.toContain('отбросил')
    openHint()
    expect(screen.getByTestId('ai-check-hint')).toHaveTextContent('отбросил 3 находки')
  })

  it('число склоняется — «1 находку», «5 находок»', () => {
    const one = panel({ dropped_findings: 1 })
    fireEvent.click(within(one.container).getByTestId('ai-check-hint-toggle'))
    expect(within(one.container).getByTestId('ai-check-hint')).toHaveTextContent('отбросил 1 находку')
    one.unmount()
    const five = panel({ dropped_findings: 5 })
    fireEvent.click(within(five.container).getByTestId('ai-check-hint-toggle'))
    expect(within(five.container).getByTestId('ai-check-hint')).toHaveTextContent('отбросил 5 находок')
  })

  it('ноль и null — в подсказке об этом ни слова', () => {
    const zero = panel({ dropped_findings: 0 })
    openHint()
    expect(screen.getByTestId('ai-check-hint')).not.toHaveTextContent('отбросил')
    zero.unmount()
    panel({ dropped_findings: null })
    openHint()
    expect(screen.getByTestId('ai-check-hint')).not.toHaveTextContent('отбросил')
  })
})
