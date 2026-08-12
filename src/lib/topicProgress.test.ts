import { describe, expect, it } from 'vitest'
import {
  courseProgress, groupDone, isSelfMarkable, topicDone, topicGroups, topicSections,
  type TopicGroupKey,
} from './topicProgress'

const progress = (groups: TopicGroupKey[], marks: TopicGroupKey[], homeworkAccepted = false) => ({
  groups, marks: new Set(marks), homeworkAccepted,
})

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

  it('тестирование ни в какую группу не входит и на завершённость не влияет', () => {
    expect(topicGroups(['test'])).toEqual([])
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
