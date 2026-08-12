import { describe, it, expect } from 'vitest'
import {
  normalizeTopicJournal, formatHomeworkScore, journalCourses, filterByCourse,
  homeworkCourseOptions, filterHomeworkByCourse, splitHomeworkBuckets,
  EMPTY_SUMMARY, type TopicJournal,
} from './topicJournal'

function journal(over: Partial<TopicJournal> = {}): TopicJournal {
  return {
    homework: [],
    tests: [],
    summary: { ...EMPTY_SUMMARY },
    ...over,
  }
}

const hw = (id: string, courseId: string, courseTitle: string) => ({
  homework_id: id, title: `ДЗ ${id}`, topic_id: `t-${id}`, topic_title: 'Тема',
  module_title: 'Основной', course_id: courseId, course_title: courseTitle,
  due_at: null, grade_scale: null, status: 'not_started' as const, score: null,
  comment: null, submitted_at: null, reviewed_at: null, attempts_count: 0, is_overdue: false,
})

const test = (id: string, courseId: string, courseTitle: string) => ({
  assignment_id: id, test_id: `test-${id}`, test_title: 'Тест', topic_id: `t-${id}`,
  topic_title: 'Тема', course_id: courseId, course_title: courseTitle,
  status: 'not_started' as const, total_points: null, max_points: null,
  percent: null, started_at: null, completed_at: null,
})

describe('normalizeTopicJournal', () => {
  it('NULL от RPC (нет доступа) — это null, а не пустой журнал', () => {
    expect(normalizeTopicJournal(null)).toBeNull()
    expect(normalizeTopicJournal(undefined)).toBeNull()
  })

  it('пропущенные ключи заполняются пустыми значениями', () => {
    const j = normalizeTopicJournal({})
    expect(j).toEqual({ homework: [], tests: [], summary: EMPTY_SUMMARY })
  })

  it('частичная сводка дополняется нулями, а не ломает счётчики', () => {
    const j = normalizeTopicJournal({ summary: { hw_total: 3 } })
    expect(j?.summary.hw_total).toBe(3)
    expect(j?.summary.tests_total).toBe(0)
    expect(j?.summary.avg_score_five).toBeNull()
  })

  it('не-объект данных отбрасывается', () => {
    expect(normalizeTopicJournal('нет')).toBeNull()
  })
})

describe('formatHomeworkScore', () => {
  it('балл без шкалы показывается как есть', () => {
    expect(formatHomeworkScore({ score: 42, grade_scale: null })).toBe('42')
  })

  it('со шкалой добавляется максимум', () => {
    expect(formatHomeworkScore({ score: 4, grade_scale: 'five' })).toBe('4 / 5')
    expect(formatHomeworkScore({ score: 88, grade_scale: 'hundred' })).toBe('88 / 100')
  })

  it('без балла оценки нет (ДЗ без шкалы принимается без оценки)', () => {
    expect(formatHomeworkScore({ score: null, grade_scale: 'five' })).toBeNull()
  })

  it('ноль — валидный балл, а не «нет оценки»', () => {
    expect(formatHomeworkScore({ score: 0, grade_scale: 'five' })).toBe('0 / 5')
  })
})

describe('journalCourses / filterByCourse', () => {
  it('курсы собираются из ДЗ и тестов без дублей', () => {
    const j = journal({
      homework: [hw('1', 'c1', 'Физика'), hw('2', 'c1', 'Физика')],
      tests: [test('3', 'c2', 'Математика')],
    })
    expect(journalCourses(j)).toEqual([
      { id: 'c1', title: 'Физика' },
      { id: 'c2', title: 'Математика' },
    ])
  })

  it('без фильтра журнал возвращается как есть', () => {
    const j = journal({ homework: [hw('1', 'c1', 'Физика')] })
    expect(filterByCourse(j, null)).toBe(j)
  })

  it('фильтр режет и ДЗ, и тесты', () => {
    const j = journal({
      homework: [hw('1', 'c1', 'Физика'), hw('2', 'c2', 'Математика')],
      tests: [test('3', 'c1', 'Физика'), test('4', 'c2', 'Математика')],
    })
    const filtered = filterByCourse(j, 'c2')
    expect(filtered.homework.map(h => h.homework_id)).toEqual(['2'])
    expect(filtered.tests.map(t => t.assignment_id)).toEqual(['4'])
  })

  it('сводка при фильтре не пересчитывается — она общая по ученику', () => {
    const j = journal({ summary: { ...EMPTY_SUMMARY, hw_total: 5 } })
    expect(filterByCourse(j, 'c1').summary.hw_total).toBe(5)
  })
})

describe('homeworkCourseOptions — ряд переключателей списка ДЗ', () => {
  const enrolled = [
    { courseId: 'c1', title: 'Физика ЕГЭ', subject: 'physics' },
    { courseId: 'c2', title: 'Математика ЕГЭ', subject: 'math' },
  ]

  it('курс без заданий остаётся в ряду с нулём', () => {
    // Считать от строк журнала было бы проще, но курс, куда ещё не выдали ДЗ,
    // тогда исчезал бы из ряда — и выглядел бы потерянным.
    const options = homeworkCourseOptions([hw('1', 'c1', 'Физика ЕГЭ')], enrolled)
    expect(options).toEqual([
      { id: 'c1', title: 'Физика ЕГЭ', subject: 'physics', count: 1 },
      { id: 'c2', title: 'Математика ЕГЭ', subject: 'math', count: 0 },
    ])
  })

  it('счётчик считает все корзины, а не только «нужно сделать»', () => {
    const rows = [
      { ...hw('1', 'c1', 'Физика ЕГЭ'), status: 'accepted' as const },
      { ...hw('2', 'c1', 'Физика ЕГЭ'), status: 'submitted' as const },
      hw('3', 'c1', 'Физика ЕГЭ'),
    ]
    expect(homeworkCourseOptions(rows, enrolled)[0].count).toBe(3)
  })

  it('курс из журнала, которого нет в зачислениях, дописывается в конец', () => {
    // Иначе его строки видны в режиме «Все», но недостижимы ни одной кнопкой.
    const options = homeworkCourseOptions([hw('1', 'c9', 'Старый курс')], enrolled)
    expect(options.map(o => o.id)).toEqual(['c1', 'c2', 'c9'])
    expect(options[2]).toEqual({ id: 'c9', title: 'Старый курс', subject: null, count: 1 })
  })

  it('порядок зачислений сохраняется как есть', () => {
    const options = homeworkCourseOptions([], [enrolled[1], enrolled[0]])
    expect(options.map(o => o.id)).toEqual(['c2', 'c1'])
  })
})

describe('filterHomeworkByCourse', () => {
  it('без курса список возвращается тем же массивом', () => {
    const rows = [hw('1', 'c1', 'Физика')]
    expect(filterHomeworkByCourse(rows, null)).toBe(rows)
  })

  it('отбирает строки одного курса', () => {
    const rows = [hw('1', 'c1', 'Физика'), hw('2', 'c2', 'Математика')]
    expect(filterHomeworkByCourse(rows, 'c2').map(r => r.homework_id)).toEqual(['2'])
  })

  it('отбор не пересортировывает: порядок задаёт splitHomeworkBuckets после него', () => {
    // Главное свойство: фильтр отбирает, а не меняет «сначала срочное».
    const rows = [
      { ...hw('soon', 'c1', 'Физика'), due_at: '2026-08-20' },
      { ...hw('late', 'c1', 'Физика'), due_at: '2026-07-01', is_overdue: true },
      { ...hw('other', 'c2', 'Математика'), due_at: '2026-08-01' },
    ]
    const all = splitHomeworkBuckets(rows).todo.map(r => r.homework_id)
    const filtered = splitHomeworkBuckets(filterHomeworkByCourse(rows, 'c1')).todo.map(r => r.homework_id)
    expect(all).toEqual(['late', 'other', 'soon'])
    expect(filtered).toEqual(['late', 'soon'])
  })
})
