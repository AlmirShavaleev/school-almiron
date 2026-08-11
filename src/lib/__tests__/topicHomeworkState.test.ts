import { describe, expect, it } from 'vitest'
import {
  describeTopicHomework, formatDueDate, groupHomeworkByTopic,
  type TopicHomeworkRow,
} from '@/lib/topicHomeworkState'

const row = (over: Partial<TopicHomeworkRow> = {}): TopicHomeworkRow => ({
  topic_id: 't1', is_published: false, due_at: null, ...over,
})

const TODAY = new Date('2026-08-10T00:00:00Z')

describe('describeTopicHomework', () => {
  it('ДЗ не создано — так и говорим', () => {
    const info = describeTopicHomework([], TODAY)

    expect(info.state).toBe('none')
    expect(info.label).toBe('ДЗ нет')
    expect(info.dueLabel).toBeNull()
  })

  /** Черновик ученику не выдан — это не «есть ДЗ», а отдельное состояние. */
  it('черновик отличается от опубликованного', () => {
    const info = describeTopicHomework([row({ due_at: '2026-09-14' })], TODAY)

    expect(info.state).toBe('draft')
    expect(info.label).toBe('ДЗ черновик')
  })

  /** Дедлайн черновика ничего не значит: ученик задания ещё не видит. */
  it('у черновика дедлайн не показываем, даже если он задан', () => {
    expect(describeTopicHomework([row({ due_at: '2026-09-14' })], TODAY).dueLabel).toBeNull()
  })

  it('опубликованное с дедлайном показывает дату', () => {
    const info = describeTopicHomework([row({ is_published: true, due_at: '2026-09-14' })], TODAY)

    expect(info.state).toBe('published')
    expect(info.dueLabel).toBe('до 14 сентября')
  })

  /** Пустой дедлайн — пустое место, а не «—»: прочерк читается как сбой загрузки. */
  it('опубликованное без дедлайна не рисует заглушку', () => {
    const info = describeTopicHomework([row({ is_published: true })], TODAY)

    expect(info.state).toBe('published')
    expect(info.dueLabel).toBeNull()
  })

  it('если у темы и черновик, и опубликованное — тема считается с заданием', () => {
    const info = describeTopicHomework(
      [row({ due_at: '2026-01-01' }), row({ is_published: true, due_at: '2026-09-14' })],
      TODAY,
    )

    expect(info.state).toBe('published')
    expect(info.dueLabel).toBe('до 14 сентября')
  })
})

describe('formatDueDate', () => {
  it('дата этого года — без года', () => {
    expect(formatDueDate('2026-09-14', TODAY)).toBe('до 14 сентября')
  })

  it('чужой год подписывается, иначе «до 3 марта» вводит в заблуждение', () => {
    expect(formatDueDate('2027-03-03', TODAY)).toContain('2027')
  })

  it('пусто и мусор не превращаются в дату', () => {
    expect(formatDueDate(null, TODAY)).toBeNull()
    expect(formatDueDate('', TODAY)).toBeNull()
    expect(formatDueDate('не дата', TODAY)).toBeNull()
  })
})

describe('groupHomeworkByTopic', () => {
  it('раскладывает один запрос по темам', () => {
    const map = groupHomeworkByTopic([
      row({ topic_id: 't1' }),
      row({ topic_id: 't2', is_published: true }),
      row({ topic_id: 't1', is_published: true }),
    ])

    expect(map.t1).toHaveLength(2)
    expect(map.t2).toHaveLength(1)
    expect(map.t3).toBeUndefined()
  })

  it('пустой ответ даёт пустую карту, а не падение', () => {
    expect(groupHomeworkByTopic([])).toEqual({})
  })
})
