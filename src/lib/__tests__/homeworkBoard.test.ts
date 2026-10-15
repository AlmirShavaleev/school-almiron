import { describe, expect, it } from 'vitest'
import { autocheckLeft, withAutocheck } from '@/lib/homeworkBoard'
import type { TopicJournalHomework } from '@/lib/topicJournal'

/** Раздел «Домашние задания»: ДЗ с автопроверкой (письмо 15.10). */
const row = (id: string, topic: string, status: TopicJournalHomework['status'] = 'not_started') => ({
  homework_id: id, title: 'ДЗ', topic_id: topic, topic_title: 'Тема', module_title: null,
  course_id: 'c', course_title: 'Курс', due_at: null, grade_scale: null, status,
  score: null, comment: null, submitted_at: null, reviewed_at: null, attempts_count: 0, is_overdue: false,
}) as TopicJournalHomework

describe('остаток задач автопроверки', () => {
  it('задача закрыта, если решена верно или потрачены 3 попытки (как _progress_state)', () => {
    const p = autocheckLeft(
      [{ id: 'k1', topic_id: 't' }, { id: 'k2', topic_id: 't' }, { id: 'k3', topic_id: 't' }],
      [
        { task_id: 'k1', is_correct: false }, { task_id: 'k1', is_correct: true },
        { task_id: 'k2', is_correct: false }, { task_id: 'k2', is_correct: false }, { task_id: 'k2', is_correct: false },
        { task_id: 'k3', is_correct: false },
      ],
    )
    expect(p.get('t')).toEqual({ total: 3, left: 1 })
  })
})

describe('статус ДЗ с автопроверкой', () => {
  it('left > 0 — «сдать», left = 0 — «принято»; обычное ДЗ — как в журнале', () => {
    const rows = withAutocheck(
      [row('a', 't1', 'accepted'), row('b', 't2'), row('c', 't3', 'submitted')],
      new Set(['a', 'b']),
      new Map([['t1', { total: 5, left: 2 }], ['t2', { total: 4, left: 0 }]]),
    )
    expect(rows.map(r => [r.homework_id, r.status, r.autocheck, r.left])).toEqual([
      ['a', 'not_started', true, 2],
      ['b', 'accepted', true, 0],
      ['c', 'submitted', false, null],
    ])
  })

  it('задачи не прочитались — статус журнала как есть', () => {
    const [r] = withAutocheck([row('a', 't1', 'submitted')], new Set(['a']), new Map())
    expect([r.status, r.autocheck, r.left]).toEqual(['submitted', true, null])
  })
})
