import { describe, expect, it } from 'vitest'
import {
  courseProgress, groupDone, isSelfMarkable, topicDone, topicGroups, topicSections,
  type TopicGroupKey,
} from './topicProgress'

const progress = (
  groups: TopicGroupKey[],
  marks: TopicGroupKey[],
  homeworkAccepted = false,
  tasks?: { total: number; solved: number },
) => ({
  groups,
  marks: new Set(marks),
  homeworkAccepted,
  tasksTotal: tasks?.total,
  tasksSolved: tasks?.solved,
})

/**
 * Серверное правило «тема пройдена» из `topic_done_events()`, записанное здесь
 * как есть: группа засчитана, если у темы её нет, либо она закрыта.
 *
 * Определение живёт в двух местах — SQL и клиент, — и приёмка §162 требует,
 * чтобы на одном наборе данных они отвечали одинаково. Эта копия нужна именно
 * для сравнения: расхождение поймает тест, а не ученик.
 */
const serverTopicDone = (t: {
  hasTheory: boolean; theoryAt: boolean
  hasLesson: boolean; lessonAt: boolean
  hasHomework: boolean; hwAt: boolean
  hasTasks: boolean; tasksTotal: number; tasksClosed: number
}) => {
  const tasksAt = t.tasksTotal > 0 && t.tasksClosed >= t.tasksTotal
  if (!(t.hasTheory || t.hasLesson || t.hasHomework || t.hasTasks)) return false
  return (!t.hasTheory || t.theoryAt)
    && (!t.hasLesson || t.lessonAt)
    && (!t.hasHomework || t.hwAt)
    && (!t.hasTasks || tasksAt)
}

describe('topicSections — считаем только те рубрики, что реально есть', () => {
  it('пустая рубрика в набор не попадает', () => {
    const sections = topicSections({
      hasVideo: false,
      sectionCounts: { notes: 2, theory: 0, tasks: 1 },
      hasHomework: false,
      hasTest: false,
    })
    expect(sections.sort()).toEqual(['notes', 'tasks'])
  })

  it('вкладка «Видео» стоит всегда, но пустое видео тему не блокирует', () => {
    // На странице темы вкладка видна и без видео (§121). В прогрессе её быть
    // не должно: отметить нечего, а тема иначе не завершится никогда.
    expect(topicSections({ hasVideo: false, sectionCounts: {}, hasHomework: true, hasTest: false }))
      .toEqual(['homework'])
  })

  it('закрытое гейтом «Решение ДЗ» — существующая рубрика', () => {
    expect(topicSections({
      hasVideo: false, sectionCounts: { solution: 0 }, hasSolution: true,
      hasHomework: false, hasTest: false,
    })).toEqual(['solution'])
  })
})

describe('topicGroups — рубрики сворачиваются в группы §121', () => {
  it('одна рубрика поднимает всю свою группу', () => {
    expect(topicGroups(['notes'])).toEqual(['theory'])
    expect(topicGroups(['tasks'])).toEqual(['lesson'])
    expect(topicGroups(['worksheet_homework'])).toEqual(['homework'])
  })

  it('группы возвращаются в порядке §121, без пустых', () => {
    expect(topicGroups(['task_solution', 'video', 'homework'])).toEqual(['theory', 'lesson', 'homework'])
  })

  // §162 отменил правило §121 «тестирование вне групп»: владелец назвал
  // рубрику «Задачи» и решил, что решённые задачи считаются в «тема пройдена».
  it('задачи к уроку образуют свою группу', () => {
    expect(topicGroups(['test'])).toEqual(['tasks'])
  })

  it('закрытое гейтом решение поднимает группу ДЗ — отмечать там всё равно нечего', () => {
    expect(topicGroups(['solution'])).toEqual(['homework'])
  })
})

describe('groupDone — ДЗ считает система, остальное отмечает ученик', () => {
  it('группа ДЗ засчитывается только принятой работой', () => {
    // Даже если строка отметки каким-то образом появится, группу она не закроет.
    expect(groupDone('homework', progress(['homework'], ['homework' as TopicGroupKey], false))).toBe(false)
    expect(groupDone('homework', progress(['homework'], [], true))).toBe(true)
  })

  it('обычная группа закрывается самоотметкой', () => {
    expect(groupDone('theory', progress(['theory'], ['theory']))).toBe(true)
    expect(groupDone('theory', progress(['theory'], []))).toBe(false)
  })

  it('отмечать можно только «Теорию» и «Урок»', () => {
    expect(isSelfMarkable('theory')).toBe(true)
    expect(isSelfMarkable('lesson')).toBe(true)
    expect(isSelfMarkable('homework')).toBe(false)
  })
})

describe('topicDone', () => {
  it('обе группы отмечены и ДЗ принято — тема завершена', () => {
    expect(topicDone(progress(['theory', 'lesson', 'homework'], ['theory', 'lesson'], true))).toBe(true)
  })

  it('всё отмечено, но ДЗ не принято — не завершена', () => {
    expect(topicDone(progress(['theory', 'lesson', 'homework'], ['theory', 'lesson'], false))).toBe(false)
  })

  it('тема без ДЗ закрывается одними отметками', () => {
    expect(topicDone(progress(['theory', 'lesson'], ['theory', 'lesson']))).toBe(true)
  })

  it('одна отметка из двух групп темы не хватает', () => {
    expect(topicDone(progress(['theory', 'lesson'], ['theory']))).toBe(false)
  })

  it('тема, где отмечать нечего, завершённой не считается', () => {
    expect(topicDone(progress([], []))).toBe(false)
  })
})

describe('courseProgress — доля завершённых ТЕМ', () => {
  it('считает темы, а не группы', () => {
    // Первая тема почти доделана, но ДЗ не принято — в зачёт не идёт.
    const result = courseProgress([
      progress(['theory', 'lesson', 'homework'], ['theory', 'lesson'], false),
      progress(['theory'], ['theory']),
    ])
    expect(result).toEqual({ done: 1, total: 2, percent: 50 })
  })

  it('темы без групп долю не портят', () => {
    const result = courseProgress([progress(['theory'], ['theory']), progress([], [])])
    expect(result).toEqual({ done: 1, total: 1, percent: 100 })
  })

  it('без тем — ноль, а не деление на ноль', () => {
    expect(courseProgress([])).toEqual({ done: 0, total: 0, percent: 0 })
  })
})

describe('«тема пройдена» — клиент и сервер отвечают одинаково (§162)', () => {
  // Один набор данных, два определения: `topicDone` на клиенте и правило
  // `topic_done_events()` на сервере. Пока они совпадают на всех случаях,
  // третьего определения в проекте нет — а именно этого требует приёмка.
  const cases: Array<{
    name: string
    hasTheory: boolean; theoryAt: boolean
    hasLesson: boolean; lessonAt: boolean
    hasHomework: boolean; hwAt: boolean
    hasTasks: boolean; tasksTotal: number; tasksClosed: number
  }> = [
    { name: 'только задачи, все решены',
      hasTheory: false, theoryAt: false, hasLesson: false, lessonAt: false,
      hasHomework: false, hwAt: false, hasTasks: true, tasksTotal: 3, tasksClosed: 3 },
    { name: 'только задачи, решена не вся',
      hasTheory: false, theoryAt: false, hasLesson: false, lessonAt: false,
      hasHomework: false, hwAt: false, hasTasks: true, tasksTotal: 3, tasksClosed: 2 },
    { name: 'теория отмечена, задачи не дорешаны',
      hasTheory: true, theoryAt: true, hasLesson: false, lessonAt: false,
      hasHomework: false, hwAt: false, hasTasks: true, tasksTotal: 2, tasksClosed: 1 },
    { name: 'теория и задачи закрыты',
      hasTheory: true, theoryAt: true, hasLesson: false, lessonAt: false,
      hasHomework: false, hwAt: false, hasTasks: true, tasksTotal: 2, tasksClosed: 2 },
    { name: 'ДЗ принято, задач нет',
      hasTheory: false, theoryAt: false, hasLesson: false, lessonAt: false,
      hasHomework: true, hwAt: true, hasTasks: false, tasksTotal: 0, tasksClosed: 0 },
    { name: 'всё сразу и всё закрыто',
      hasTheory: true, theoryAt: true, hasLesson: true, lessonAt: true,
      hasHomework: true, hwAt: true, hasTasks: true, tasksTotal: 1, tasksClosed: 1 },
    { name: 'у темы нет ничего',
      hasTheory: false, theoryAt: false, hasLesson: false, lessonAt: false,
      hasHomework: false, hwAt: false, hasTasks: false, tasksTotal: 0, tasksClosed: 0 },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const groups: TopicGroupKey[] = []
      const marks: TopicGroupKey[] = []
      if (c.hasTheory)   { groups.push('theory');   if (c.theoryAt) marks.push('theory') }
      if (c.hasLesson)   { groups.push('lesson');   if (c.lessonAt) marks.push('lesson') }
      if (c.hasHomework) { groups.push('homework') }
      if (c.hasTasks)    { groups.push('tasks') }

      const client = topicDone(progress(groups, marks, c.hwAt,
        { total: c.tasksTotal, solved: c.tasksClosed }))

      expect(client).toBe(serverTopicDone(c))
    })
  }
})
