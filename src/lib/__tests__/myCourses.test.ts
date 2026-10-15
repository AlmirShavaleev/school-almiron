import { describe, expect, it } from 'vitest'
import { accessLine, courseLadder, publicTitle, visibleSteps } from '@/lib/myCourses'

/** «Мои курсы»: название, строка доступа и прогресс варианта «Б» (письма 15.10). */
const mods = (n: number) => Array.from({ length: n }, (_, i) => ({ moduleId: `m${i}`, title: `Раздел ${i}`, done: 0, total: 10 }))

describe('лестница разделов', () => {
  it('открыто не меньше пройдено и не больше всего; «можно делать» = открыто − пройдено', () => {
    const l = courseLadder(
      [{ moduleId: 'a', title: 'A', done: 5, total: 10 }, { moduleId: 'b', title: 'B', done: 0, total: 10 }],
      new Map([['a', 3], ['b', 15]]), 5, 20,
    )
    expect(l.steps.map(s => s.open)).toEqual([5, 10])
    expect(l.open).toBe(15)
    expect(l.available).toBe(10)
    expect([l.donePct, l.openPct]).toEqual([25, 75])
  })

  it('«открыто» не узнали — только пройдено, без «можно делать»', () => {
    const l = courseLadder([{ moduleId: 'a', title: 'A', done: 2, total: 4 }], null, 2, 4)
    expect([l.open, l.openPct, l.available]).toEqual([null, null, null])
    expect(l.steps[0]).toMatchObject({ open: 2, current: false })
  })

  it('разделов больше 6 — текущий и 2 соседних, остальное под «ещё N»', () => {
    const steps = courseLadder(mods(9), new Map([['m4', 3]]), 0, 90).steps
    const v = visibleSteps(steps)
    expect(v.shown.map(s => s.moduleId)).toEqual(['m3', 'm4', 'm5'])
    expect(v.hidden).toBe(6)
    expect(visibleSteps(steps.slice(0, 6)).hidden).toBe(0)
  })
})

describe('название и доступ', () => {
  it('служебные пометки убираются, название с витрины главнее', () => {
    expect(publicTitle('Физика ЕГЭ — подписка (тест)', null)).toBe('Физика ЕГЭ — подписка')
    expect(publicTitle('Физика ЕГЭ (новый) Тестовый', 'Физика ЕГЭ')).toBe('Физика ЕГЭ')
  })

  it('без подписки — школьная группа с учителем, иначе с группой', () => {
    expect(accessLine(null, { teacher: 'Иванова', group: '11А' }).text).toBe('Школьная группа · Иванова')
    expect(accessLine(undefined, { teacher: null, group: '11А' }).text).toBe('Школьная группа · 11А')
  })
})
