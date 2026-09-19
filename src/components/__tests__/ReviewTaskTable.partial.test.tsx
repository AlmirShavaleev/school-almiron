import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReviewTaskTable } from '@/components/courseProgram/ReviewTaskTable'
import {
  isPartialCheck,
  partialCheckReason,
  type AiJobRow,
  type AiTaskRow,
} from '@/lib/aiHomeworkCheck'

/**
 * §189. «Проверена не вся работа» вместо балла.
 *
 * Живой прогон v17 дал «балл 97, уверенность высокая» по работе, от которой до
 * модели доехали 8 страниц из 11: пять заданий стояли «unchecked» с заметкой
 * «задание отсутствует», а в резюме мелким шрифтом — «взяты страницы 1–8 из
 * 11». Функция теперь гасит балл, а панель обязана назвать причину — иначе
 * пустое место читается как «ИИ не справился».
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
  task({ no: '1' }),
  task({ no: '2', verdict: 'unchecked', student_answer: '', expected_answer: '', note: 'задание отсутствует' }),
]

const SUMMARY = [
  'Работа выполнена аккуратно.',
  'Не сверены задания (в балл не вошли): 2.',
  'Проверено не всё:\n— Прототипы.pdf — взяты страницы 1–8 из 11',
].join('\n\n')

const job = (over: Partial<AiJobRow> = {}): AiJobRow => ({
  id: 'j1',
  attempt_id: 'a1',
  status: 'done',
  provider: 'openrouter',
  model: 'qwen/qwen3-vl-235b-a22b-instruct',
  readable: true,
  suggested_score: null,
  confidence: 'low',
  summary: SUMMARY,
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

const panel = (over: Partial<AiJobRow> = {}) => render(
  <ReviewTaskTable
    job={job(over)}
    findings={[]}
    running={false}
    error={null}
    onRun={() => {}}
  />,
)

describe('isPartialCheck', () => {
  it('балла нет, а таблица есть — проверка неполная', () => {
    expect(isPartialCheck(job())).toBe(true)
  })

  it('балл есть — плашке взяться неоткуда', () => {
    expect(isPartialCheck(job({ suggested_score: 84, confidence: 'medium' }))).toBe(false)
  })

  it('нечитаемая работа и проверки старее v17 — это другие случаи, не этот', () => {
    // «ИИ не смог разобрать работу» панель говорит своей плашкой.
    expect(isPartialCheck(job({ readable: false }))).toBe(false)
    // У проверок старее v17 таблицы нет вовсе, и балла у них не бывало.
    expect(isPartialCheck(job({ tasks: null }))).toBe(false)
    expect(isPartialCheck(job({ status: 'processing' }))).toBe(false)
    expect(isPartialCheck(null)).toBe(false)
  })
})

describe('partialCheckReason', () => {
  it('берёт из разбора ровно те абзацы, что объясняют неполноту', () => {
    expect(partialCheckReason(SUMMARY)).toBe(
      'Не сверены задания (в балл не вошли): 2.'
      + '\n\nПроверено не всё:\n— Прототипы.pdf — взяты страницы 1–8 из 11',
    )
  })

  it('объяснения в разборе нет — и показывать нечего', () => {
    expect(partialCheckReason('Работа выполнена аккуратно.')).toBeNull()
    expect(partialCheckReason(null)).toBeNull()
    expect(partialCheckReason('')).toBeNull()
  })
})

describe('ReviewTaskTable — плашка вместо балла', () => {
  it('вместо балла — причина, а не пустое «балл не предлагается»', () => {
    panel()
    expect(screen.getByTestId('ai-check-partial')).toHaveTextContent('Проверена не вся работа')
    expect(screen.queryByTestId('ai-check-score')).not.toBeInTheDocument()
    expect(screen.queryByText('Балл не предлагается')).not.toBeInTheDocument()
  })

  it('под плашкой — список непрочитанного из разбора', () => {
    panel()
    const reason = screen.getByTestId('ai-check-partial-reason')
    expect(reason).toHaveTextContent('взяты страницы 1–8 из 11')
    expect(reason).toHaveTextContent('Не сверены задания')
  })

  it('строки unchecked остаются видны в таблице', () => {
    panel()
    const unchecked = screen.getAllByTestId('ai-task-row').filter(r => r.dataset.verdict === 'unchecked')
    expect(unchecked).toHaveLength(1)
    expect(unchecked[0]).toHaveTextContent('задание отсутствует')
  })

  it('балл в сводке по заданиям тоже молчит', () => {
    panel()
    expect(screen.getByTestId('ai-check-tasks-summary')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-check-tasks-score')).not.toBeInTheDocument()
  })

  it('балл есть — плашки нет, панель как прежде', () => {
    panel({ suggested_score: 84, confidence: 'medium' })
    expect(screen.queryByTestId('ai-check-partial')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-check-partial-reason')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-check-score')).toHaveTextContent('84')
  })

  it('низкая уверенность сама по себе плашки не даёт: балл есть, просто не показан', () => {
    panel({ suggested_score: 84, confidence: 'low' })
    expect(screen.queryByTestId('ai-check-partial')).not.toBeInTheDocument()
    expect(screen.getByText('Балл не предлагается')).toBeInTheDocument()
  })
})
