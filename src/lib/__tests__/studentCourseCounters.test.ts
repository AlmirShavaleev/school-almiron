import { describe, expect, it } from 'vitest'
import {
  countTopics,
  homeworkLabel,
  isHomeworkSubmitted,
  openPercent,
  sumCounters,
  topicsLabel,
  type CountableTopic,
} from '../studentCourseCounters'

/**
 * §141. Ученик видел «0 из 0» там, где ждал число доступных тем: счётчик
 * считал задания, а заданий на проде почти нет. Фикстура ниже — ровно тот
 * случай: часть тем открыта, часть закрыта, опубликованных ДЗ ноль.
 */

const TODAY = '2026-09-06'

const topic = (over: Partial<CountableTopic> = {}): CountableTopic => ({
  is_open: null,
  available_from: null,
  hasHomework: false,
  hwStatus: null,
  ...over,
})

/** Прод на 06.09: темы открыты, ДЗ не опубликовано ни одного. */
const PROD_LIKE: CountableTopic[] = [
  topic({ is_open: true }),
  topic({ is_open: true }),
  topic({ available_from: '2026-09-01' }),
  topic({ is_open: false }),
  topic({ available_from: '2026-12-01' }),
]

describe('счёт тем — главный счётчик', () => {
  it('на проде считает открытые темы, а не задания', () => {
    const counters = countTopics(PROD_LIKE, TODAY)

    expect(counters).toEqual({
      openTopics: 3,
      totalTopics: 5,
      homeworkAvailable: 0,
      homeworkSubmitted: 0,
    })
    // Раньше здесь было «0 из 0»: заданий нет, а тем — три.
    expect(topicsLabel(counters)).toBe('3 из 5 тем открыто')
    expect(openPercent(counters)).toBe(60)
  })

  it('закрытая тумблером тема закрыта, даже если дата наступила', () => {
    // Правило берётся из isTopicOpen (§59), своей копии здесь нет.
    const counters = countTopics([topic({ is_open: false, available_from: '2020-01-01' })], TODAY)
    expect(counters.openTopics).toBe(0)
  })

  it('курс без тем даёт ноль процентов, а не деление на ноль', () => {
    expect(openPercent(countTopics([], TODAY))).toBe(0)
    expect(topicsLabel(countTopics([], TODAY))).toBe('0 из 0 тем открыто')
  })
})

describe('строка домашних заданий', () => {
  it('когда публикаций нет — говорит словами, а не пустотой', () => {
    expect(homeworkLabel(countTopics(PROD_LIKE, TODAY))).toBe('Домашних заданий пока нет')
  })

  it('считает сданные из ДОСТУПНЫХ, а не из всех', () => {
    const counters = countTopics([
      topic({ is_open: true, hasHomework: true, hwStatus: 'accepted' }),
      topic({ is_open: true, hasHomework: true, hwStatus: 'submitted' }),
      topic({ is_open: true, hasHomework: true, hwStatus: 'not_started' }),
      // Задание закрытой темы ученик ещё не видел — в знаменатель не идёт.
      topic({ is_open: false, hasHomework: true, hwStatus: 'not_started' }),
    ], TODAY)

    expect(counters.homeworkAvailable).toBe(3)
    expect(counters.homeworkSubmitted).toBe(2)
    expect(homeworkLabel(counters)).toBe('Домашние задания: 2 из 3 сдано')
  })

  it('возвращённая на доработку работа не считается сданной', () => {
    // Мяч на стороне ученика: показывать её в «сдано» значило бы сказать, что
    // дело сделано.
    expect(isHomeworkSubmitted('returned')).toBe(false)
    expect(isHomeworkSubmitted('draft')).toBe(false)
    expect(isHomeworkSubmitted('submitted')).toBe(true)
    expect(isHomeworkSubmitted('accepted')).toBe(true)
  })
})

describe('курс = сумма разделов', () => {
  it('складывает счётчики модулей тем же правилом', () => {
    const first = countTopics([topic({ is_open: true }), topic({ is_open: false })], TODAY)
    const second = countTopics([
      topic({ is_open: true, hasHomework: true, hwStatus: 'accepted' }),
    ], TODAY)

    expect(sumCounters([first, second])).toEqual({
      openTopics: 2,
      totalTopics: 3,
      homeworkAvailable: 1,
      homeworkSubmitted: 1,
    })
  })

  it('без разделов — нули, а не NaN', () => {
    expect(sumCounters([])).toEqual({
      openTopics: 0, totalTopics: 0, homeworkAvailable: 0, homeworkSubmitted: 0,
    })
  })
})

describe('topicsLabel — склонение', () => {
  // Слово согласуется со ВТОРЫМ числом: именно оно стоит рядом с ним.
  // Обращение ученика 09.09 было ровно про это — «2 тем» вместо «2 темы».
  const label = (open: number, total: number) =>
    topicsLabel({
      openTopics: open, totalTopics: total,
      homeworkAvailable: 0, homeworkSubmitted: 0,
    })

  it('набор из приёмки', () => {
    expect(label(0, 1)).toBe('0 из 1 тема открыто')
    expect(label(1, 2)).toBe('1 из 2 темы открыто')
    expect(label(2, 5)).toBe('2 из 5 тем открыто')
    expect(label(2, 21)).toBe('2 из 21 тема открыто')
    expect(label(2, 22)).toBe('2 из 22 темы открыто')
    expect(label(2, 25)).toBe('2 из 25 тем открыто')
    expect(label(2, 111)).toBe('2 из 111 тем открыто')
  })

  it('второй десяток не берёт форму от последней цифры', () => {
    expect(label(1, 11)).toBe('1 из 11 тем открыто')
    expect(label(1, 12)).toBe('1 из 12 тем открыто')
  })

  it('тот самый случай из жалобы', () => {
    expect(label(2, 2)).toBe('2 из 2 темы открыто')
    expect(label(2, 2)).not.toContain('2 тем открыто')
  })
})
