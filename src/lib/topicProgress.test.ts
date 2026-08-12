import { describe, expect, it } from 'vitest'
import { courseProgress, isSelfMarkable, sectionDone, topicDone, topicSections } from './topicProgress'
import type { TopicSection } from './topicMaterialItems'

const progress = (sections: TopicSection[], marks: TopicSection[], homeworkAccepted = false) => ({
  sections, marks: new Set(marks), homeworkAccepted,
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
    expect(topicSections({ hasVideo: true, sectionCounts: {}, hasHomework: false, hasTest: false }))
      .toEqual(['video'])
  })

  it('закрытое гейтом «Решение ДЗ» — существующая рубрика', () => {
    const sections = topicSections({
      hasVideo: false, sectionCounts: { solution: 0 }, hasSolution: true,
      hasHomework: false, hasTest: false,
    })
    expect(sections).toEqual(['solution'])
  })
})

describe('sectionDone — ДЗ считает система, остальное отмечает ученик', () => {
  it('ДЗ засчитывается только принятой работой, отметкой — никогда', () => {
    // Даже если строка отметки каким-то образом появится, ДЗ она не закроет.
    const p = progress(['homework'], ['homework' as TopicSection], false)
    expect(sectionDone('homework', p)).toBe(false)
    expect(sectionDone('homework', progress(['homework'], [], true))).toBe(true)
  })

  it('обычный раздел закрывается самоотметкой', () => {
    expect(sectionDone('notes', progress(['notes'], ['notes']))).toBe(true)
    expect(sectionDone('notes', progress(['notes'], []))).toBe(false)
  })

  it('ДЗ отмечать самому нельзя, тест — пока можно', () => {
    expect(isSelfMarkable('homework')).toBe(false)
    expect(isSelfMarkable('test')).toBe(true)
    expect(isSelfMarkable('video')).toBe(true)
  })
})

describe('topicDone', () => {
  it('все разделы отмечены и ДЗ принято — тема завершена', () => {
    expect(topicDone(progress(['video', 'notes', 'homework'], ['video', 'notes'], true))).toBe(true)
  })

  it('всё отмечено, но ДЗ не принято — не завершена', () => {
    expect(topicDone(progress(['video', 'notes', 'homework'], ['video', 'notes'], false))).toBe(false)
  })

  it('тема без ДЗ закрывается одними отметками', () => {
    expect(topicDone(progress(['video', 'notes'], ['video', 'notes']))).toBe(true)
  })

  it('тема без разделов завершённой не считается', () => {
    expect(topicDone(progress([], []))).toBe(false)
  })
})

describe('courseProgress — доля завершённых ТЕМ', () => {
  it('считает темы, а не разделы', () => {
    // Первая тема почти доделана, но ДЗ не принято — в зачёт не идёт.
    const result = courseProgress([
      progress(['video', 'notes', 'tasks', 'homework'], ['video', 'notes', 'tasks'], false),
      progress(['notes'], ['notes']),
    ])
    expect(result).toEqual({ done: 1, total: 2, percent: 50 })
  })

  it('пустые темы не портят долю', () => {
    const result = courseProgress([
      progress(['notes'], ['notes']),
      progress([], []),
    ])
    expect(result).toEqual({ done: 1, total: 1, percent: 100 })
  })

  it('без тем — ноль, а не деление на ноль', () => {
    expect(courseProgress([])).toEqual({ done: 0, total: 0, percent: 0 })
  })
})
