/**
 * Раскладка ответа `course_topic_tasks_matrix` в таблицу «ученик × тема» (§174).
 *
 * RPC отдаёт плоские строки — по одной на пару «ученик × тема с задачами».
 * Здесь они собираются в столбцы (темы в порядке программы), строки (ученики
 * по имени) и ячейки с состоянием, по которому красится клетка. Логика вынесена
 * из компонента, чтобы четыре состояния ячейки проверялись без DOM.
 */

/** Строка RPC. Типы базы не перегенерированы — описано локально. */
export interface TopicTasksMatrixRow {
  /** null — у курса есть темы с задачами, но ни одного ученика. */
  student_id: string | null
  full_name: string | null
  topic_id: string
  topic_title: string
  module_order: number
  topic_order: number
  tasks_total: number
  touched: number
  closed_auto: number
  closed_self: number
}

export interface MatrixTopic {
  id: string
  title: string
  tasksTotal: number
}

/**
 * Состояние ячейки — по смыслу, а не по числу (§152):
 *  - `done`   — закрыты все задачи темы;
 *  - `partial` — закрыта часть;
 *  - `zero`   — отвечал, но ничего не закрыл;
 *  - `untouched` — тему не открывал (ни одного ответа).
 */
export type MatrixCellState = 'done' | 'partial' | 'zero' | 'untouched'

export interface MatrixCell {
  topicId: string
  total: number
  closed: number
  closedAuto: number
  closedSelf: number
  touched: number
  state: MatrixCellState
}

export interface MatrixStudent {
  id: string
  name: string
  cells: MatrixCell[]
  /** «решено X из Y по курсу» */
  closedTotal: number
  tasksTotal: number
}

export interface MatrixFooter {
  topicId: string
  /** сколько учеников закрыли все задачи темы */
  doneStudents: number
  students: number
}

export interface TopicTasksMatrix {
  topics: MatrixTopic[]
  students: MatrixStudent[]
  footer: MatrixFooter[]
}

export function cellState(total: number, closed: number, touched: number): MatrixCellState {
  if (total > 0 && closed >= total) return 'done'
  if (closed > 0) return 'partial'
  if (touched > 0) return 'zero'
  return 'untouched'
}

/**
 * Темы — в порядке программы: модуль → тема. Сортировка устойчивая, поэтому
 * ничья по `order_index` (в каркасах математики модули нумеруются номерами
 * заданий ЕГЭ с пропусками, §172) решается порядком, в котором RPC отдала
 * строки, — а она сортирует по `created_at`.
 */
function collectTopics(rows: TopicTasksMatrixRow[]): MatrixTopic[] {
  const seen = new Map<string, { topic: MatrixTopic; moduleOrder: number; topicOrder: number; idx: number }>()
  rows.forEach((r, idx) => {
    if (seen.has(r.topic_id)) return
    seen.set(r.topic_id, {
      topic: { id: r.topic_id, title: r.topic_title, tasksTotal: r.tasks_total },
      moduleOrder: r.module_order,
      topicOrder: r.topic_order,
      idx,
    })
  })
  return Array.from(seen.values())
    .sort((a, b) => a.moduleOrder - b.moduleOrder || a.topicOrder - b.topicOrder || a.idx - b.idx)
    .map(x => x.topic)
}

export function buildTopicTasksMatrix(rows: TopicTasksMatrixRow[]): TopicTasksMatrix {
  const topics = collectTopics(rows)

  const byStudent = new Map<string, { name: string; cells: Map<string, TopicTasksMatrixRow> }>()
  for (const r of rows) {
    if (!r.student_id) continue
    const entry = byStudent.get(r.student_id) ?? { name: r.full_name || 'Ученик', cells: new Map() }
    entry.cells.set(r.topic_id, r)
    byStudent.set(r.student_id, entry)
  }

  const students: MatrixStudent[] = Array.from(byStudent.entries())
    .map(([id, { name, cells }]) => {
      const cellList: MatrixCell[] = topics.map(t => {
        const r = cells.get(t.id)
        const closedAuto = r?.closed_auto ?? 0
        const closedSelf = r?.closed_self ?? 0
        const closed = closedAuto + closedSelf
        const touched = r?.touched ?? 0
        return {
          topicId: t.id,
          total: t.tasksTotal,
          closed,
          closedAuto,
          closedSelf,
          touched,
          state: cellState(t.tasksTotal, closed, touched),
        }
      })
      return {
        id,
        name,
        cells: cellList,
        closedTotal: cellList.reduce((s, c) => s + c.closed, 0),
        tasksTotal: topics.reduce((s, t) => s + t.tasksTotal, 0),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  const footer: MatrixFooter[] = topics.map((t, i) => ({
    topicId: t.id,
    doneStudents: students.filter(s => s.cells[i].state === 'done').length,
    students: students.length,
  }))

  return { topics, students, footer }
}
