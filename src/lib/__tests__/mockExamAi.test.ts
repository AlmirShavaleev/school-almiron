/**
 * §222b. Логика экрана для предложений ИИ: «Принять все» не трогает
 * поставленные баллы, рамки на листе, состояние проверки, прогресс «Работ».
 */
import { describe, expect, it } from 'vitest'
import {
  AI_STALE_MS, acceptAllAi, acceptAllCount, aiPointsLine, aiProgress, aiRunState, aiStatusLine, aiUsable, firstRegion,
  regionsOnSheet, suggestionsByTask, type AiRun, type AiSuggestion,
} from '../mockExamAi'

const MAX = [1, 1, 1, 2, 3, 4]
const s = (task_number: number, points: number, extra: Partial<AiSuggestion> = {}): AiSuggestion =>
  ({ student_id: 'a', task_number, points, max_points: MAX[task_number - 1] ?? 0, confidence: 'high', comment: null, regions: [], ...extra })
const NOW = Date.parse('2026-10-07T10:00:00Z')
const run = (status: AiRun['status'], minutesAgo = 1, extra: Partial<AiRun> = {}): AiRun => ({
  student_id: 'a', status, last_error: null, note: null,
  requested_at: new Date(NOW - minutesAgo * 60_000).toISOString(), started_at: null, finished_at: null, ...extra,
})

describe('«Принять все»', () => {
  it('только пустые клетки второй части; ручные баллы (и ноль) не трогает; первую часть не трогает', () => {
    const by = suggestionsByTask([s(2, 1), s(4, 1), s(5, 3), s(6, 2), { ...s(4, 0), student_id: 'b' }], 'a')
    const points = [1, null, 1, null, 0, null]
    const r = acceptAllAi(points, by, 3, MAX)
    expect(r.points).toEqual([1, null, 1, 1, 0, 2])
    expect(r.accepted).toEqual([4, 6])
    // Вход не мутирован.
    expect(points).toEqual([1, null, 1, null, 0, null])
    expect(acceptAllCount(r.points, by, 3, MAX)).toBe(0)
  })
  it('предложение больше нынешнего максимума (шаблон поправили) — не принимается', () => {
    const by = suggestionsByTask([s(4, 3), s(5, 1)], 'a')
    expect(aiUsable(by.get(4), 2)).toBe(false)
    expect(acceptAllAi([1, 1, 1, null, null, null], by, 3, MAX).accepted).toEqual([5])
  })
})

describe('рамки', () => {
  const sg = s(4, 1, { regions: [
    { photo_id: 'ph1', page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
    { photo_id: 'ph2', page: 2, x: 0.3, y: 0.4, w: 0.2, h: 0.1 },
  ] })
  it('на листе — только его фото и страница; фото без страниц — page 1', () => {
    expect(regionsOnSheet(sg, 'ph1', null)).toHaveLength(1)
    expect(regionsOnSheet(sg, 'ph2', 2)).toEqual([{ photo_id: 'ph2', page: 2, x: 0.3, y: 0.4, w: 0.2, h: 0.1 }])
    expect(regionsOnSheet(sg, 'ph2', 1)).toEqual([])
    expect(regionsOnSheet(null, 'ph1', null)).toEqual([])
    expect(firstRegion(sg)?.photo_id).toBe('ph1')
    expect(firstRegion(s(5, 1))).toBeNull()
  })
})

describe('состояние проверки', () => {
  it('queued/running дольше 10 минут — оборвалась', () => {
    expect(aiRunState(null, NOW)).toBe('none')
    expect(aiRunState(run('running', 2), NOW)).toBe('running')
    expect(aiRunState(run('queued', AI_STALE_MS / 60_000 + 1), NOW)).toBe('stale')
    expect(aiRunState(run('done', 100), NOW)).toBe('done')
  })
  it('строка статуса словами', () => {
    expect(aiStatusLine('error', run('error', 1, { last_error: 'Модель отказала: 502' }), 0)).toEqual({ tone: 'error', text: 'ИИ: ошибка — Модель отказала: 502' })
    expect(aiStatusLine('done', run('done'), 0).text).toBe('ИИ проверил, но баллов не предложил — поставьте сами')
    expect(aiStatusLine('none', null, 0).text).toBe('ИИ ещё не проверял эту работу')
    expect(aiPointsLine(s(5, 2), 3)).toBe('ИИ: 2 из 3')
  })
})

describe('прогресс «Работ»', () => {
  it('проверено N из M (M — с фото); «у всех» — без предложений и без идущей проверки', () => {
    const students = [{ id: 'a', photos: 2 }, { id: 'b', photos: 1 }, { id: 'c', photos: 0 }, { id: 'd', photos: 1 }, { id: 'e', photos: 1 }, { id: 'f', photos: 3 }]
    const sugs = [s(4, 1), { ...s(4, 1), student_id: 'c' }]
    const runs = [
      { ...run('running', 1), student_id: 'b' },
      { ...run('error', 1), student_id: 'd' },
      { ...run('done', 1), student_id: 'e' },
    ]
    expect(aiProgress(students, sugs, runs, NOW)).toEqual({ of: 5, checked: 2, active: 1, failed: 1, toCheck: ['d', 'f'] })
  })
})
