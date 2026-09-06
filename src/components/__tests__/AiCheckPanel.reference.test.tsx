import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AiCheckPanel } from '@/components/courseProgram/AiCheckPanel'
import { referenceNotice, type AiJobRow } from '@/lib/aiHomeworkCheck'

/**
 * §135. Проверка без авторского эталона — другой уровень доверия: модель
 * сверяла работу со СВОИМ решением. Преподаватель обязан это видеть, иначе
 * он верит разбору так же, как разбору с эталоном.
 */

const job = (over: Partial<AiJobRow> = {}): AiJobRow => ({
  id: 'j1',
  attempt_id: 'a1',
  status: 'done',
  provider: 'openrouter',
  model: 'qwen/qwen3-vl-235b-a22b-instruct',
  readable: true,
  suggested_score: 80,
  confidence: 'medium',
  summary: 'Разбор',
  last_error: null,
  reference_state: 'used',
  reference_chars: 4200,
  accepted_at: null,
  created_at: '2026-08-18T10:00:00Z',
  completed_at: '2026-08-18T10:01:00Z',
  ...over,
})

const panel = (over: Partial<AiJobRow> = {}) => render(
  <AiCheckPanel
    job={job(over)}
    findings={[]}
    running={false}
    error={null}
    onRun={async () => {}}
    onApplyFrames={async () => 0}
    onUseText={() => {}}
  />,
)

describe('referenceNotice', () => {
  it('с эталоном — молчит', () => {
    expect(referenceNotice(job({ reference_state: 'used' }))).toBeNull()
  })

  it('у темы нет решения — говорит прямо', () => {
    expect(referenceNotice(job({ reference_state: 'missing' }))).toMatch(/без эталона/i)
  })

  it('разбор PDF не удался — тоже говорит', () => {
    expect(referenceNotice(job({ reference_state: 'failed' }))).toMatch(/не удалось прочитать/i)
  })

  it('пока проверка идёт — не говорит ничего', () => {
    expect(referenceNotice(job({ status: 'processing', reference_state: null }))).toBeNull()
  })

  it('у старых проверок (до §135) плашки нет', () => {
    // Там эталона не было гарантированно, но врать задним числом не будем:
    // столбец пустой, значит и сказать нечего.
    expect(referenceNotice(job({ reference_state: null }))).toBeNull()
  })
})

describe('AiCheckPanel — плашка «без эталона»', () => {
  it('при разборе без эталона плашка видна', () => {
    panel({ reference_state: 'missing' })
    expect(screen.getByTestId('ai-check-no-reference')).toHaveTextContent('без эталона')
  })

  it('при разборе с эталоном плашки нет', () => {
    panel({ reference_state: 'used' })
    expect(screen.queryByTestId('ai-check-no-reference')).not.toBeInTheDocument()
  })

  it('плашка не заменяет собой разбор и балл', () => {
    panel({ reference_state: 'failed' })
    expect(screen.getByTestId('ai-check-no-reference')).toBeInTheDocument()
    expect(screen.getByTestId('ai-check-summary')).toHaveTextContent('Разбор')
    expect(screen.getByTestId('ai-check-score')).toHaveTextContent('80')
  })
})
