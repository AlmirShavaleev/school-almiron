import { describe, expect, it } from 'vitest'
import {
  DASH,
  MIN_GROUP_FOR_AVG,
  MIN_TASKS_FOR_TOPIC,
  averageScore,
  cleanSteps,
  egeTagLabel,
  formatDelta,
  formatPeriod,
  groupAverage,
  onTime,
  polylinePoints,
  sortSubjects,
  sparkPoints,
  targetLabel,
  topicBasis,
  topicsForList,
  watchTime,
  worksBreakdown,
  type ReportTopic,
} from '@/lib/parentReport'

/**
 * §217. Правила отчёта, из-за которых он и делался. Проверки поведенческие:
 * что именно напечатается на листе, который родитель унесёт домой.
 */

describe('средний балл', () => {
  it('НИКОГДА не едет без числа работ — иначе 100 % по одной работе читается как готовность', () => {
    const one = averageScore(100, 1)
    expect(one.value).toBe('100 %')
    expect(one.note).toBe('по 1 проверенной работе')

    const seven = averageScore(62, 7)
    expect(seven.value).toBe('62 %')
    expect(seven.note).toBe('по 7 проверенным работам')
  })

  it('склонение работает и на двойке, и на пятёрке, и на одиннадцати', () => {
    expect(averageScore(50, 2).note).toBe('по 2 проверенным работам')
    expect(averageScore(50, 5).note).toBe('по 5 проверенным работам')
    expect(averageScore(50, 11).note).toBe('по 11 проверенным работам')
  })

  it('проверенных работ нет — прочерк с пояснением, а не ноль процентов', () => {
    const none = averageScore(null, 0)
    expect(none.value).toBe(DASH)
    expect(none.dashed).toBe(true)
    expect(none.note).toMatch(/проверенных работ/)
  })

  it('число работ есть, а балла нет — всё равно прочерк, а не 0 %', () => {
    expect(averageScore(null, 4).value).toBe(DASH)
  })
})

describe('среднее по группе', () => {
  it('порог — шесть человек, и он назван числом', () => {
    expect(MIN_GROUP_FOR_AVG).toBe(6)
  })

  it('в группе пять человек — прочерк С ПОЯСНЕНИЕМ', () => {
    const five = groupAverage(58, 5)
    expect(five.value).toBe(DASH)
    expect(five.dashed).toBe(true)
    expect(five.note).toBe('в группе 5 человек, среднее не печатаем')
  })

  it('в группе шесть человек — число', () => {
    const six = groupAverage(58, 6)
    expect(six.value).toBe('58 %')
    expect(six.dashed).toBe(false)
    expect(six.note).toBe('6 человек в группе')
  })

  /**
   * Ради чего правило: в группе из трёх среднее рядом с баллом сына
   * позволяет родителю вычислить остальных.
   */
  it('в группе трое — среднего не видно ни при каком балле', () => {
    expect(groupAverage(99, 3).value).toBe(DASH)
    expect(groupAverage(null, 3).value).toBe(DASH)
    expect(groupAverage(0, 3).value).toBe(DASH)
  })

  it('группа большая, но проверенных работ в ней нет — тоже прочерк, а не 0 %', () => {
    const empty = groupAverage(null, 9)
    expect(empty.value).toBe(DASH)
    expect(empty.note).toMatch(/проверенных работ/)
  })

  it('склонение размера группы: 9 человек, 22 человека, 21 человек', () => {
    expect(groupAverage(50, 9).note).toBe('9 человек в группе')
    expect(groupAverage(50, 22).note).toBe('22 человека в группе')
    expect(groupAverage(50, 21).note).toBe('21 человек в группе')
  })
})

describe('цель по предмету (§216)', () => {
  it('цели нет — прочерк, а НЕ ноль: ноль читался бы как «цель — ноль баллов»', () => {
    expect(targetLabel(null)).toContain(DASH)
    expect(targetLabel(null)).not.toMatch(/\b0\b/)
  })

  it('цель есть — печатается числом', () => {
    expect(targetLabel(75)).toBe('цель на экзамене — 75 баллов')
  })
})

describe('темы', () => {
  const topic = (over: Partial<ReportTopic>): ReportTopic => ({
    topic_id: 't1', title: 'Термодинамика', subject: 'physics',
    ege_numbers: [24], tasks_counted: 9, correct_percent: 41, ...over,
  })

  it('порог — три задания', () => {
    expect(MIN_TASKS_FOR_TOPIC).toBe(3)
  })

  it('тема с двумя заданиями в список не попадает, с тремя попадает', () => {
    const two = topicsForList([topic({ topic_id: 'a', tasks_counted: 2 })])
    expect(two).toHaveLength(0)

    const three = topicsForList([topic({ topic_id: 'b', tasks_counted: 3 })])
    expect(three).toHaveLength(1)
  })

  it('число заданий печатается рядом с процентом', () => {
    expect(topicBasis(9)).toBe('9 заданий')
    expect(topicBasis(1)).toBe('1 задание')
    expect(topicBasis(2)).toBe('2 задания')
    expect(topicBasis(21)).toBe('21 задание')
  })

  it('тема на несколько номеров показывает все', () => {
    expect(egeTagLabel([6, 7])).toBe('№6, 7')
    expect(egeTagLabel([13])).toBe('№13')
  })

  it('тема без номера помечается словом, а не пустотой', () => {
    expect(egeTagLabel([])).toBe('без номера')
    expect(egeTagLabel(null)).toBe('без номера')
  })
})

describe('работы и сроки', () => {
  it('состав работ печатается только по непустым долям', () => {
    expect(worksBreakdown({ submitted: 9, accepted: 7, revision: 1, pending: 1, with_due: 9, on_time: 7, late: 2 }))
      .toBe('принято 7 · на доработке 1 · ждёт проверки 1')
    expect(worksBreakdown({ submitted: 4, accepted: 4, revision: 0, pending: 0, with_due: 4, on_time: 4, late: 0 }))
      .toBe('принято 4')
    expect(worksBreakdown({ submitted: 0, accepted: 0, revision: 0, pending: 0, with_due: 0, on_time: 0, late: 0 }))
      .toBe('работ за период нет')
  })

  it('«сдано вовремя» — дробь и слово про опоздания', () => {
    const late = onTime(12, 14, 2)
    expect(late.value).toBe('12 / 14')
    expect(late.note).toBe('2 работы с опозданием')

    expect(onTime(5, 5, 0).note).toBe('все работы в срок')
  })

  it('сроков не проставлено — прочерк, а не «0 / 0»', () => {
    const none = onTime(0, 0, 0)
    expect(none.value).toBe(DASH)
    expect(none.dashed).toBe(true)
  })
})

describe('мелочи листа', () => {
  it('время просмотра', () => {
    expect(watchTime(12000)).toBe('3 ч 20 м')
    expect(watchTime(2880)).toBe('48 м')
    expect(watchTime(0)).toBe('0 м')
  })

  it('прирост пробника со знаком, ноль — нулём', () => {
    expect(formatDelta(6)).toBe('+6')
    expect(formatDelta(-4)).toBe('−4')
    expect(formatDelta(0)).toBe('0')
    expect(formatDelta(null)).toBeNull()
  })

  it('период печатается по-человечески', () => {
    expect(formatPeriod('2026-09-01', '2026-09-25')).toBe('01.09 — 25.09.2026')
  })

  it('пустые строки «что делать» не превращаются в пустые пункты списка', () => {
    expect(cleanSteps(['Раз', '  ', 'Два', 'Три', 'Четыре'])).toEqual(['Раз', 'Два', 'Три'])
    expect(cleanSteps(null)).toEqual([])
  })

  it('предметы идут по русскому названию, а не по коду базы', () => {
    const subjects = [
      { subject: 'physics' } as never,
      { subject: 'math' } as never,
    ]
    const labels: Record<string, string> = { physics: 'Физика', math: 'Математика' }
    expect(sortSubjects(subjects, s => labels[s] ?? s).map(s => (s as { subject: string }).subject))
      .toEqual(['math', 'physics'])
  })
})

describe('маленький график', () => {
  const weeks = [
    { week_start: '2026-09-01', avg_percent: 55, works: 2 },
    { week_start: '2026-09-08', avg_percent: 60, works: 1 },
    { week_start: '2026-09-15', avg_percent: 62, works: 3 },
  ]

  it('шкала фиксированная 0..100: три процента разницы не превращаются в отвес', () => {
    const points = sparkPoints(weeks, 320, 48)
    expect(points).toHaveLength(3)
    // 55 и 62 различаются, но обе точки в верхней половине — на подвижной
    // шкале первая упиралась бы в низ, а последняя в верх графика.
    expect(points[0].y).toBeGreaterThan(points[2].y)
    expect(points[0].y).toBeLessThan(48)
    expect(points[2].y).toBeGreaterThan(0)
  })

  it('точки подписаны числами — на чёрно-белой печати линия сама по себе нечитаема', () => {
    expect(sparkPoints(weeks, 320, 48).map(p => p.label)).toEqual(['55', '60', '62'])
  })

  it('одна неделя не ломает график', () => {
    const one = sparkPoints([weeks[0]], 320, 48)
    expect(one).toHaveLength(1)
    expect(Number.isFinite(one[0].x)).toBe(true)
  })

  it('недель нет — точек нет', () => {
    expect(sparkPoints([], 320, 48)).toEqual([])
    expect(polylinePoints([])).toBe('')
  })
})
