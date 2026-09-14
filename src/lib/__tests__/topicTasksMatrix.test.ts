import { describe, expect, it } from 'vitest'
import { buildTopicTasksMatrix, cellState, type TopicTasksMatrixRow } from '@/lib/topicTasksMatrix'

/**
 * §174. Раскладка ответа `course_topic_tasks_matrix` в таблицу «ученик × тема».
 * Четыре состояния ячейки — по смыслу (§152), не по числу: «ноль при ответах»
 * и «не открывал» выглядят одинаково по числу закрытых, но это разные вещи.
 */

const row = (over: Partial<TopicTasksMatrixRow>): TopicTasksMatrixRow => ({
  student_id: 's1', full_name: 'Иванов', topic_id: 't1', topic_title: 'Тема 1',
  module_order: 1, topic_order: 1, tasks_total: 5, touched: 0, closed_auto: 0, closed_self: 0,
  ...over,
})

describe('cellState — цвет по смыслу', () => {
  it('все закрыты → done', () => expect(cellState(5, 5, 5)).toBe('done'))
  it('часть закрыта → partial', () => expect(cellState(5, 2, 4)).toBe('partial'))
  it('ноль закрыто, но отвечал → zero', () => expect(cellState(5, 0, 3)).toBe('zero'))
  it('ни одного ответа → untouched', () => expect(cellState(5, 0, 0)).toBe('untouched'))
  it('тема без задач никогда не «done»', () => expect(cellState(0, 0, 0)).toBe('untouched'))
})

describe('buildTopicTasksMatrix', () => {
  it('столбцы — в порядке программы (модуль → тема), а не в порядке строк', () => {
    const m = buildTopicTasksMatrix([
      row({ topic_id: 't3', topic_title: 'М2 Т1', module_order: 2, topic_order: 1 }),
      row({ topic_id: 't2', topic_title: 'М1 Т2', module_order: 1, topic_order: 2 }),
      row({ topic_id: 't1', topic_title: 'М1 Т1', module_order: 1, topic_order: 1 }),
    ])
    expect(m.topics.map(t => t.id)).toEqual(['t1', 't2', 't3'])
  })

  it('ничья по order_index решается порядком строк RPC (она сортирует по created_at)', () => {
    const m = buildTopicTasksMatrix([
      row({ topic_id: 'later', module_order: 8, topic_order: 1 }),
      row({ topic_id: 'earlier', module_order: 8, topic_order: 1 }),
    ])
    expect(m.topics.map(t => t.id)).toEqual(['later', 'earlier'])
  })

  it('ячейки: закрыто = по ответу + по разбору, итог по курсу — сумма по темам', () => {
    const m = buildTopicTasksMatrix([
      row({ topic_id: 't1', tasks_total: 5, touched: 5, closed_auto: 3, closed_self: 2 }),
      row({ topic_id: 't2', topic_order: 2, tasks_total: 4, touched: 3, closed_auto: 1, closed_self: 0 }),
      row({ topic_id: 't3', topic_order: 3, tasks_total: 3, touched: 2, closed_auto: 0, closed_self: 0 }),
      row({ topic_id: 't4', topic_order: 4, tasks_total: 2, touched: 0 }),
    ])
    const [s] = m.students
    expect(s.cells.map(c => c.state)).toEqual(['done', 'partial', 'zero', 'untouched'])
    expect(s.cells.map(c => `${c.closed}/${c.total}`)).toEqual(['5/5', '1/4', '0/3', '0/2'])
    expect(s.closedTotal).toBe(6)
    expect(s.tasksTotal).toBe(14)
  })

  it('ученики — по имени; строка без пары «ученик × тема» считается нетронутой', () => {
    const m = buildTopicTasksMatrix([
      row({ student_id: 's2', full_name: 'Яковлев', topic_id: 't1' }),
      row({ student_id: 's2', full_name: 'Яковлев', topic_id: 't2', topic_order: 2, touched: 1 }),
      row({ student_id: 's1', full_name: 'Абрамов', topic_id: 't1', touched: 5, closed_auto: 5 }),
      // у Абрамова нет строки по t2 — не должно ронять раскладку
    ])
    expect(m.students.map(s => s.name)).toEqual(['Абрамов', 'Яковлев'])
    expect(m.students[0].cells[1].state).toBe('untouched')
  })

  it('итоговая строка: сколько учеников закрыли всё по каждой теме', () => {
    const m = buildTopicTasksMatrix([
      row({ student_id: 's1', full_name: 'А', topic_id: 't1', touched: 5, closed_auto: 5 }),
      row({ student_id: 's2', full_name: 'Б', topic_id: 't1', touched: 5, closed_auto: 4 }),
      row({ student_id: 's3', full_name: 'В', topic_id: 't1', touched: 5, closed_auto: 2, closed_self: 3 }),
    ])
    expect(m.footer).toEqual([{ topicId: 't1', doneStudents: 2, students: 3 }])
  })

  it('строка с student_id = null (учеников нет) даёт столбец, но не ученика', () => {
    const m = buildTopicTasksMatrix([row({ student_id: null, full_name: null })])
    expect(m.topics).toHaveLength(1)
    expect(m.students).toHaveLength(0)
    expect(m.footer[0].students).toBe(0)
  })

  it('пустой ответ — пустая матрица', () => {
    expect(buildTopicTasksMatrix([])).toEqual({ topics: [], students: [], footer: [] })
  })
})
