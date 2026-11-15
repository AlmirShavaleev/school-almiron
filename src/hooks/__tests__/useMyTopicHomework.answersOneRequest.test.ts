/**
 * 15.11: ответы автопроверки ученика — один запрос по profile_id, а не пачки
 * по 40 id задач (на курсе с ~900 задачами было 20–25 запросов подряд).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { table: string; select: string; filters: Array<[string, string, unknown]>; limit?: number }
const calls: Call[] = []
let tables: Record<string, { data: unknown[] | null; error: unknown }> = {}

function chain(table: string, select: string) {
  const call: Call = { table, select, filters: [] }
  calls.push(call)
  const q: Record<string, unknown> = {
    in: (c: string, v: unknown) => { call.filters.push(['in', c, v]); return q },
    eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return q },
    limit: (n: number) => { call.limit = n; return q },
    then: (ok: (r: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(tables[table] ?? { data: [], error: null }).then(ok, bad),
  }
  return q
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => ({ select: (s: string) => chain(t, s) }) },
}))

import { AUTOCHECK_ANSWERS_ROW_CAP, loadAutocheck } from '@/hooks/useMyTopicHomework'

const tasks = Array.from({ length: 900 }, (_, i) => ({ id: `task-${i}`, topic_id: i < 450 ? 'topic-a' : 'topic-b' }))

beforeEach(() => {
  calls.length = 0
  tables = {
    topic_homework: { data: [{ id: 'hw-a', topic_id: 'topic-a' }, { id: 'hw-b', topic_id: 'topic-b' }], error: null },
    topic_autocheck_tasks: { data: tasks, error: null },
    topic_autocheck_answers: {
      data: [
        { task_id: 'task-0', is_correct: true },
        { task_id: 'task-1', is_correct: false },
        { task_id: 'task-from-another-course', is_correct: true },
      ],
      error: null,
    },
  }
})

describe('loadAutocheck — ответы одним запросом', () => {
  it('900 задач — ровно один запрос ответов, по profile_id, без списка id задач', async () => {
    const r = await loadAutocheck(['topic-a', 'topic-b'], 'me')
    const ans = calls.filter(c => c.table === 'topic_autocheck_answers')
    expect(ans).toHaveLength(1)
    expect(ans[0].filters).toEqual([['eq', 'profile_id', 'me']])
    expect(ans[0].limit).toBe(AUTOCHECK_ANSWERS_ROW_CAP)
    expect([...r.hw].sort()).toEqual(['hw-a', 'hw-b'])
    expect(r.progress.size).toBeGreaterThan(0)
  })

  it('ответ упёрся в предел строк — статус журнала (пусто), а не ложное «осталось решить»', async () => {
    tables.topic_autocheck_answers = {
      data: Array.from({ length: AUTOCHECK_ANSWERS_ROW_CAP }, (_, i) => ({ task_id: `x-${i}`, is_correct: true })),
      error: null,
    }
    const r = await loadAutocheck(['topic-a'], 'me')
    expect(r.hw.size).toBe(0)
    expect(r.progress.size).toBe(0)
  })

  it('ошибка чтения ответов или нет входа — пусто, запросов ответов без входа нет', async () => {
    tables.topic_autocheck_answers = { data: null, error: { message: 'boom' } }
    expect((await loadAutocheck(['topic-a'], 'me')).hw.size).toBe(0)
    calls.length = 0
    const r = await loadAutocheck(['topic-a'], null)
    expect(r.hw.size).toBe(0)
    expect(calls).toHaveLength(0)
  })
})
