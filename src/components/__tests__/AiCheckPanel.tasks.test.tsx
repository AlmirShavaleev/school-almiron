import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AiCheckPanel } from '@/components/courseProgram/AiCheckPanel'
import {
  aiTasksOf,
  findingsOfTask,
  summarizeTasks,
  taskNoFromText,
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
  <AiCheckPanel
    job={job(over)}
    findings={findings}
    running={false}
    error={null}
    onRun={() => {}}
    onApplyFrames={async () => 0}
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

describe('AiCheckPanel — блок «По заданиям»', () => {
  it('строки идут в порядке ответа модели', () => {
    panel()
    const rows = screen.getAllByTestId('ai-task-row')
    expect(rows.map(r => r.dataset.no)).toEqual(['3', '1', '2', '4'])
  })

  it('сводка считает вердикты и показывает балл, из которого они сложились', () => {
    panel()
    const summary = screen.getByTestId('ai-check-tasks-summary')
    expect(summary).toHaveTextContent('верно 1')
    expect(summary).toHaveTextContent('неверно 1')
    expect(summary).toHaveTextContent('частично 1')
    expect(summary).toHaveTextContent('не сверено 1')
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

  it('клик по неверной строке подсвечивает её находку, второй клик снимает', () => {
    panel()
    const wrong = screen.getAllByTestId('ai-task-row').find(r => r.dataset.verdict === 'wrong')!
    expect(screen.getAllByTestId('ai-check-finding').some(f => f.dataset.active === 'true')).toBe(false)

    fireEvent.click(within(wrong).getByRole('button'))
    const active = screen.getAllByTestId('ai-check-finding').filter(f => f.dataset.active === 'true')
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('знак ускорения')

    fireEvent.click(within(wrong).getByRole('button'))
    expect(screen.getAllByTestId('ai-check-finding').some(f => f.dataset.active === 'true')).toBe(false)
  })

  it('частичное задание тоже подсвечивает свою находку', () => {
    panel()
    const partial = screen.getAllByTestId('ai-task-row').find(r => r.dataset.verdict === 'partial')!
    fireEvent.click(within(partial).getByRole('button'))
    const active = screen.getAllByTestId('ai-check-finding').filter(f => f.dataset.active === 'true')
    expect(active).toHaveLength(1)
    expect(active[0]).toHaveTextContent('хода решения нет')
  })

  it('у верной и несверенной строки нажимать не на что', () => {
    panel()
    for (const verdict of ['correct', 'unchecked']) {
      const row = screen.getAllByTestId('ai-task-row').find(r => r.dataset.verdict === verdict)!
      expect(within(row).queryByRole('button')).toBeNull()
    }
  })

  it('строка без находки не кликается — нажатие, которое ничего не делает, читается как поломка', () => {
    panel({}, [finding({ id: 'f9', category: 'format', text: 'Нет единиц измерения.' })])
    const wrong = screen.getAllByTestId('ai-task-row').find(r => r.dataset.verdict === 'wrong')!
    expect(within(wrong).queryByRole('button')).toBeNull()
  })

  it('при низкой уверенности балл в сводке молчит, как и в шапке', () => {
    panel({ confidence: 'low' })
    expect(screen.getByTestId('ai-check-tasks-summary')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-check-tasks-score')).not.toBeInTheDocument()
  })
})

describe('AiCheckPanel — проверка старее v17', () => {
  it('без таблицы блока нет, а панель работает как раньше', () => {
    panel({ tasks: null })
    expect(screen.queryByTestId('ai-check-tasks')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-check-summary')).toHaveTextContent('Разбор')
    expect(screen.getByTestId('ai-check-apply-frames')).toBeInTheDocument()
  })

  it('столбца tasks в строке нет вовсе — тоже без блока и без падения', () => {
    const legacy = job()
    delete legacy.tasks
    render(
      <AiCheckPanel job={legacy} findings={FINDINGS} running={false} error={null} onRun={() => {}} onApplyFrames={async () => 0} />,
    )
    expect(screen.queryByTestId('ai-check-tasks')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-check-panel')).toBeInTheDocument()
  })
})

describe('AiCheckPanel — отброшенные находки', () => {
  it('больше нуля — говорим об этом серой строкой', () => {
    panel({ dropped_findings: 3 })
    expect(screen.getByTestId('ai-check-dropped')).toHaveTextContent('отбросил 3 находки')
  })

  it('число склоняется — «1 находку», «5 находок»', () => {
    panel({ dropped_findings: 1 })
    expect(screen.getByTestId('ai-check-dropped')).toHaveTextContent('отбросил 1 находку')
    panel({ dropped_findings: 5 })
    expect(screen.getAllByTestId('ai-check-dropped')[1]).toHaveTextContent('отбросил 5 находок')
  })

  it('ноль и null — молчим', () => {
    panel({ dropped_findings: 0 })
    expect(screen.queryByTestId('ai-check-dropped')).not.toBeInTheDocument()
    panel({ dropped_findings: null })
    expect(screen.queryByTestId('ai-check-dropped')).not.toBeInTheDocument()
  })
})
