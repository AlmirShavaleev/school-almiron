import { describe, expect, it } from 'vitest'
import {
  EMPTY_ANSWERS, buildQualityRows, feedbackCsv, parseAnswers, parseFeedbackRows, sortByProblem, toPayload, toggleHardSpot,
  type FeedbackRow,
} from '@/lib/topicFeedback'

// Опрос о качестве урока (письмо 16.10): правила формы, сводка «Качество уроков», CSV для методиста.

describe('форма опроса', () => {
  it('«Ничего, всё понятно» снимает остальные «где трудно» и наоборот', () => {
    expect(toggleHardSpot(['theory', 'video'], 'nothing')).toEqual(['nothing'])
    expect(toggleHardSpot(['nothing'], 'theory')).toEqual(['theory'])
    expect(toggleHardSpot(['theory'], 'theory')).toEqual([])
  })

  it('в запрос не уходит лишнее: темп без видео, номера без отметки, детали ошибки при «Нет»', () => {
    const p = toPayload({
      ...EMPTY_ANSWERS,
      video: 'none', video_pace: 'fast',
      hard_spots: ['theory'], hard_lesson_task: '3',
      found_error: false, error_where: 'tasks', error_text: 'x',
      improve: '   ',
    })
    expect(p.video_pace).toBeNull()
    expect(p.hard_lesson_task).toBeNull()
    expect(p.error_where).toBeNull()
    expect(p.error_text).toBeNull()
    expect(p.improve).toBeNull()
  })

  it('номера задач и текст ошибки сохраняются, когда отмечены', () => {
    const p = toPayload({ ...EMPTY_ANSWERS, hard_spots: ['hw_task'], hard_hw_task: ' 5 ', found_error: true, error_where: 'solutions', error_task: '2', error_text: 'знак' })
    expect(p).toMatchObject({ hard_hw_task: '5', found_error: true, error_where: 'solutions', error_task: '2', error_text: 'знак' })
  })

  it('чужие коды из базы отбрасываются', () => {
    const a = parseAnswers({ clarity: 'maybe', hard_spots: ['theory', 'zzz'], found_error: 'yes' })
    expect(a.clarity).toBeNull()
    expect(a.hard_spots).toEqual(['theory'])
    expect(a.found_error).toBeNull()
  })
})

const row = (topic: string, over: Partial<FeedbackRow> = {}): FeedbackRow => ({
  ...EMPTY_ANSWERS, topicId: topic, studentId: 's', studentName: 'Ученик', updatedAt: '2026-10-16T10:00:00Z', ...over,
})
const modules = [{ title: 'Кинематика', topics: [{ id: 't1', title: 'Скорость' }, { id: 't2', title: 'Ускорение' }, { id: 't3', title: 'Графики' }] }]

describe('«Качество уроков»', () => {
  const rows = [
    row('t2', { clarity: 'partly', hw_self: 'few', lesson_difficulty: 'hard', hard_spots: ['lesson_task'], hard_lesson_task: '4' }),
    row('t2', { clarity: 'no', hw_self: 'none', lesson_difficulty: 'hard', hard_spots: ['lesson_task', 'picture'], hard_lesson_task: '4',
      found_error: true, error_where: 'solutions', error_task: '4', error_text: 'не тот ответ', studentId: 's2', studentName: 'Петя', improve: 'больше примеров' }),
    row('t1', { clarity: 'full', hw_self: 'all', lesson_difficulty: 'ok', hard_spots: ['nothing'] }),
  ]
  const q = buildQualityRows(modules, rows, [{ topicId: 't1', ratings: 3, avg: 9 }, { topicId: 't2', ratings: 2, avg: 4.5 }])

  it('по теме: % непонятно, % «ДЗ сам меньше половины», сложность, «где трудно» с номерами', () => {
    const t2 = q.find(r => r.topicId === 't2')!
    expect(t2.answers).toBe(2)
    expect(t2.unclearPct).toBe(100)
    expect(t2.hwLowPct).toBe(100)
    expect(t2.difficulty).toEqual({ easy: 0, ok: 0, hard: 2 })
    expect(t2.hardTop[0]).toEqual({ label: 'Задача урока № 4', n: 2 })
    expect(t2.errors).toEqual([{ studentId: 's2', studentName: 'Петя', where: 'Решения', task: '4', text: 'не тот ответ' }])
    expect(t2.wishes).toEqual([{ studentName: 'Петя', text: 'больше примеров' }])
    expect(t2.avgRating).toBe(4.5)
  })

  it('«Ничего, всё понятно» в «где трудно» не считается', () => {
    expect(q.find(r => r.topicId === 't1')!.hardTop).toEqual([])
  })

  it('худшие сверху, тема без ответов и оценок — в конце', () => {
    expect(sortByProblem(q).map(r => r.topicId)).toEqual(['t2', 't1', 't3'])
    expect(q.find(r => r.topicId === 't3')!.score).toBe(0)
  })
})

describe('CSV', () => {
  it('BOM, «;», русские подписи, кавычки вокруг текста с разделителем', () => {
    const csv = feedbackCsv(
      [row('t1', { clarity: 'mostly', improve: 'теория; видео', found_error: false })],
      new Map([['t1', { title: 'Скорость', moduleTitle: 'Кинематика' }]]),
    )
    expect(csv.startsWith('﻿Раздел;Тема;Ученик')).toBe(true)
    const line = csv.split('\r\n')[1]
    expect(line).toContain('Кинематика;Скорость;Ученик;2026-10-16;В основном')
    expect(line).toContain(';Нет;')
    expect(line.endsWith('"теория; видео"')).toBe(true)
  })

  it('строки ответов курса разбираются, без topic_id — отбрасываются', () => {
    const r = parseFeedbackRows([{ topic_id: 't1', student_id: 's1', student_name: 'Аня', clarity: 'no', updated_at: 'x' }, { clarity: 'no' }])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ topicId: 't1', studentName: 'Аня', clarity: 'no' })
  })
})
