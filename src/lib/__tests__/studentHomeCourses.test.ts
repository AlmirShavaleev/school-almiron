import { describe, expect, it } from 'vitest'
import { continueHref, normalizeHomeCourses, percentOf, primaryContinue } from '@/lib/studentHomeCourses'

const RAW = [
  {
    course_id: 'c1', topics_total: 10, topics_done: 3,
    modules: [
      { module_id: 'm1', title: 'Кинематика', order_index: 1, total: 4, done: 3 },
      { module_id: 'm2', title: 'Динамика', order_index: 2, total: 6, done: 0 },
    ],
    continue: { topic_id: 't7', title: 'Второй закон Ньютона', module_title: 'Динамика' },
  },
  { course_id: 'c2', topics_total: 0, topics_done: 0, modules: [], continue: null },
]

describe('normalizeHomeCourses', () => {
  it('ответ RPC → курсы с % по разделам и следующей темой', () => {
    const [a, b] = normalizeHomeCourses(RAW)
    expect(a).toMatchObject({ courseId: 'c1', done: 3, total: 10, percent: 30 })
    expect(a.modules.map(m => [m.title, m.percent])).toEqual([['Кинематика', 75], ['Динамика', 0]])
    expect(a.next).toEqual({ topicId: 't7', title: 'Второй закон Ньютона', moduleTitle: 'Динамика' })
    expect(b).toMatchObject({ courseId: 'c2', percent: 0, modules: [], next: null })
  })

  it('битый ответ не роняет главную', () => {
    expect(normalizeHomeCourses(null)).toEqual([])
    expect(normalizeHomeCourses({})).toEqual([])
    expect(normalizeHomeCourses([null, 1, { course_id: 5 }, { course_id: 'x', modules: [null, { title: 'без id' }] }]))
      .toEqual([{ courseId: 'x', done: 0, total: 0, percent: 0, modules: [], next: null }])
  })
})

describe('percentOf', () => {
  it('округляет, не делит на ноль и не выходит за 100', () => {
    expect(percentOf(1, 3)).toBe(33)
    expect(percentOf(0, 0)).toBe(0)
    expect(percentOf(5, 4)).toBe(100)
  })
})

describe('продолжить', () => {
  const courses = [
    { courseId: 'c2', groupId: 'g2', courseTitle: 'Математика' },
    { courseId: 'c1', groupId: 'g1', courseTitle: 'Физика' },
  ]
  const progress = normalizeHomeCourses(RAW)

  it('большая кнопка — первый по порядку курс, где есть следующая тема', () => {
    expect(primaryContinue(courses, progress)).toEqual({
      course: courses[1],
      next: { topicId: 't7', title: 'Второй закон Ньютона', moduleTitle: 'Динамика' },
    })
    expect(primaryContinue(courses.slice(0, 1), progress)).toBeNull()
  })

  it('ссылка — в тему, без темы — в курс', () => {
    expect(continueHref('g1', progress[0].next)).toBe('/my-course/g1/topic/t7')
    expect(continueHref('g2', null)).toBe('/my-course/g2')
  })
})
