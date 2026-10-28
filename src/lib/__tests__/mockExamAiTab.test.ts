import { describe, expect, it } from 'vitest'
import { aiReferenceWarnings, aiStateBadge, aiTabRows, type AiRun, type AiSuggestion } from '@/lib/mockExamAi'

/** Письмо 28.10: вкладка «Проверка ИИ» пробника — чистая часть. */
const sug = (student_id: string, task_number: number, points: number, max_points = 3): AiSuggestion =>
  ({ student_id, task_number, points, max_points, confidence: 'high', comment: null, regions: [], created_at: null })
const NOW = Date.parse('2026-10-28T10:00:00Z')
const run = (student_id: string, status: AiRun['status'], minutesAgo = 1): AiRun => {
  const t = new Date(NOW - minutesAgo * 60_000).toISOString()
  return { student_id, status, last_error: status === 'error' ? 'сбой' : null, note: null, requested_at: t, started_at: t, finished_at: status === 'done' || status === 'error' ? t : null }
}

describe('aiStateBadge', () => {
  it('короткие слова статуса', () => {
    expect(aiStateBadge('none', false).label).toBe('не проверял')
    expect(aiStateBadge('none', true).label).toBe('готово')
    expect(aiStateBadge('queued', false).label).toBe('в очереди')
    expect(aiStateBadge('running', false).label).toBe('идёт')
    expect(aiStateBadge('stale', false)).toEqual({ tone: 'error', label: 'ошибка' })
  })
})

describe('aiTabRows', () => {
  it('предложения по номерам второй части; негодное (больше максимума) — не показываем', () => {
    const rows = aiTabRows(
      [{ id: 'a', name: 'А', photos: 2 }, { id: 'b', name: 'Б', photos: 0 }],
      [sug('a', 4, 1), sug('a', 5, 9)], [], NOW, 3, [1, 1, 1, 2, 3],
    )
    expect(rows[0].tasks.map(t => [t.task, t.max, t.suggestion?.points ?? null])).toEqual([[4, 2, 1], [5, 3, null]])
    expect(rows[0].runLabel).toBe('Повторить')
    expect(rows[1].canRun).toBe(false)
  })
  it('зависшая проверка (больше 10 минут) — ошибка с подсказкой, можно повторить', () => {
    const [r] = aiTabRows([{ id: 'a', name: 'А', photos: 1 }], [], [run('a', 'running', 15)], NOW, 3, [1, 1, 1, 2, 3])
    expect(r.state).toBe('stale')
    expect(r.error).toMatch(/оборвалась/)
    expect(r.canRun).toBe(true)
  })
})

describe('aiReferenceWarnings', () => {
  const v = (id: string, s: string | null, c: string | null, label: string | null = null) =>
    ({ id, position: Number(id.slice(1)), label, solution_path: s, criteria_path: c })
  it('нет ни решения, ни критериев — одной строкой; подпись варианта — как в «Работах»', () => {
    expect(aiReferenceWarnings({ examSolutionPath: null, variants: [v('v2', null, null, 'Резерв')], usedVariantIds: new Set(['v2']), anyPhotos: true }))
      .toEqual(['ИИ проверит хуже: у «Резерв» нет решения и критериев — загрузите в «Настройке».'])
  })
  it('без фото — молчим; всё есть — молчим', () => {
    expect(aiReferenceWarnings({ examSolutionPath: null, variants: [], usedVariantIds: new Set(), anyPhotos: false })).toEqual([])
    expect(aiReferenceWarnings({ examSolutionPath: null, variants: [v('v1', 's', 'c')], usedVariantIds: new Set(['v1']), anyPhotos: true })).toEqual([])
  })
})
