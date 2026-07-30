import { describe, expect, it } from 'vitest'
import {
  needsAction,
  splitHomeworkBuckets,
  type JournalHwStatus,
  type TopicJournalHomework,
} from '@/lib/topicJournal'

function hw(over: Partial<TopicJournalHomework> & { homework_id: string; status: JournalHwStatus }): TopicJournalHomework {
  return {
    title: 'ДЗ',
    topic_id: 't1',
    topic_title: 'Тема',
    module_title: null,
    course_id: 'c1',
    course_title: 'Курс',
    due_at: null,
    grade_scale: 'five',
    score: null,
    comment: null,
    submitted_at: null,
    reviewed_at: null,
    attempts_count: 0,
    is_overdue: false,
    ...over,
  }
}

describe('splitHomeworkBuckets', () => {
  it('раскладывает по трём корзинам: нужно сделать / на проверке / проверено', () => {
    const rows = [
      hw({ homework_id: 'a', status: 'not_started' }),
      hw({ homework_id: 'b', status: 'draft' }),
      hw({ homework_id: 'c', status: 'returned' }),
      hw({ homework_id: 'd', status: 'submitted' }),
      hw({ homework_id: 'e', status: 'accepted' }),
    ]
    const { todo, awaiting, done } = splitHomeworkBuckets(rows)

    // Черновик и возвращённое — это тоже «нужно сделать»: без них ученик
    // не увидел бы, что работа ждёт его действий.
    expect(todo.map(r => r.homework_id)).toEqual(['a', 'b', 'c'])
    expect(awaiting.map(r => r.homework_id)).toEqual(['d'])
    expect(done.map(r => r.homework_id)).toEqual(['e'])
  })

  it('просроченное поднимает выше более близкого дедлайна', () => {
    const rows = [
      hw({ homework_id: 'soon', status: 'not_started', due_at: '2026-08-01T00:00:00Z' }),
      hw({ homework_id: 'late', status: 'not_started', due_at: '2026-07-10T00:00:00Z', is_overdue: true }),
    ]
    expect(splitHomeworkBuckets(rows).todo.map(r => r.homework_id)).toEqual(['late', 'soon'])
  })

  it('внутри одной группы сортирует по дедлайну, работы без срока — в конец', () => {
    const rows = [
      hw({ homework_id: 'none', status: 'not_started', due_at: null }),
      hw({ homework_id: 'later', status: 'not_started', due_at: '2026-09-01T00:00:00Z' }),
      hw({ homework_id: 'earlier', status: 'not_started', due_at: '2026-08-01T00:00:00Z' }),
    ]
    expect(splitHomeworkBuckets(rows).todo.map(r => r.homework_id)).toEqual(['earlier', 'later', 'none'])
  })

  it('проверенные — свежими сверху по дате вердикта', () => {
    const rows = [
      hw({ homework_id: 'old', status: 'accepted', reviewed_at: '2026-07-01T10:00:00Z' }),
      hw({ homework_id: 'new', status: 'accepted', reviewed_at: '2026-07-29T10:00:00Z' }),
      hw({ homework_id: 'noDate', status: 'accepted', reviewed_at: null }),
    ]
    expect(splitHomeworkBuckets(rows).done.map(r => r.homework_id)).toEqual(['new', 'old', 'noDate'])
  })

  it('не мутирует входной массив', () => {
    const rows = [
      hw({ homework_id: 'b', status: 'not_started', due_at: '2026-09-01T00:00:00Z' }),
      hw({ homework_id: 'a', status: 'not_started', due_at: '2026-08-01T00:00:00Z' }),
    ]
    const orderBefore = rows.map(r => r.homework_id)
    splitHomeworkBuckets(rows)
    expect(rows.map(r => r.homework_id)).toEqual(orderBefore)
  })

  it('пустой вход — три пустые корзины, без падения', () => {
    expect(splitHomeworkBuckets([])).toEqual({ todo: [], awaiting: [], done: [] })
  })

  it('needsAction: только то, что ждёт ученика', () => {
    const statuses: JournalHwStatus[] = ['not_started', 'draft', 'submitted', 'returned', 'accepted']
    const flags = statuses.map(s => needsAction(hw({ homework_id: s, status: s })))
    expect(flags).toEqual([true, true, false, true, false])
  })
})
