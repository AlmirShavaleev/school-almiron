import { describe, it, expect } from 'vitest'
import {
  isTopicOpen,
  isDateAutomation,
  willOpenByDate,
  topicClosedLabel,
  topicToggleLabel,
} from '../topicAvailability'

const TODAY = '2026-08-03'
const PAST = '2026-07-01'
const FUTURE = '2026-09-01'

describe('isTopicOpen — зеркало SQL topic_open_now', () => {
  it('без тумблера и без даты тема открыта', () => {
    expect(isTopicOpen({ is_open: null, available_from: null }, TODAY)).toBe(true)
  })

  it('без тумблера с прошедшей датой тема открыта', () => {
    expect(isTopicOpen({ is_open: null, available_from: PAST }, TODAY)).toBe(true)
  })

  it('без тумблера с будущей датой тема закрыта', () => {
    expect(isTopicOpen({ is_open: null, available_from: FUTURE }, TODAY)).toBe(false)
  })

  it('в день наступления даты тема уже открыта', () => {
    expect(isTopicOpen({ is_open: null, available_from: TODAY }, TODAY)).toBe(true)
  })

  it('включённый тумблер главнее будущей даты', () => {
    expect(isTopicOpen({ is_open: true, available_from: FUTURE }, TODAY)).toBe(true)
  })

  it('выключенный тумблер главнее прошедшей даты', () => {
    expect(isTopicOpen({ is_open: false, available_from: PAST }, TODAY)).toBe(false)
  })

  it('выключенный тумблер закрывает тему и без даты', () => {
    expect(isTopicOpen({ is_open: false, available_from: null }, TODAY)).toBe(false)
  })

  it('ISO-строка с временем сравнивается по дате', () => {
    expect(isTopicOpen({ is_open: null, available_from: '2026-09-01T21:00:00.000Z' }, TODAY)).toBe(false)
  })
})

describe('автоматика по дате', () => {
  it('тема без тумблера живёт по дате', () => {
    expect(isDateAutomation({ is_open: null, available_from: FUTURE })).toBe(true)
  })

  it('тронутый тумблер отключает автоматику', () => {
    expect(isDateAutomation({ is_open: false, available_from: FUTURE })).toBe(false)
    expect(isDateAutomation({ is_open: true, available_from: FUTURE })).toBe(false)
  })

  it('будущая дата откроет тему сама только при автоматике', () => {
    expect(willOpenByDate({ is_open: null, available_from: FUTURE }, TODAY)).toBe(FUTURE)
    expect(willOpenByDate({ is_open: false, available_from: FUTURE }, TODAY)).toBeNull()
  })

  it('прошедшая дата ничего не откроет', () => {
    expect(willOpenByDate({ is_open: null, available_from: PAST }, TODAY)).toBeNull()
  })
})

describe('подпись под закрытой темой', () => {
  it('показывает дату, когда она действительно сработает', () => {
    expect(topicClosedLabel({ is_open: null, available_from: FUTURE }, TODAY)).toBe('Откроется 1 сентября')
  })

  it('не обещает дату, если тема закрыта тумблером', () => {
    expect(topicClosedLabel({ is_open: false, available_from: FUTURE }, TODAY)).toBe('Откроется позже')
  })

  it('без даты — неопределённая подпись', () => {
    expect(topicClosedLabel({ is_open: false, available_from: null }, TODAY)).toBe('Откроется позже')
  })
})

describe('подпись тумблера в строке списка', () => {
  it('открытая тема', () => {
    expect(topicToggleLabel({ is_open: true, available_from: null }, TODAY)).toBe('Открыта')
    expect(topicToggleLabel({ is_open: null, available_from: PAST }, TODAY)).toBe('Открыта')
  })

  it('закрытая тумблером — без даты, даже если дата задана', () => {
    expect(topicToggleLabel({ is_open: false, available_from: FUTURE }, TODAY)).toBe('Закрыта')
  })

  it('на автоматике показывает короткую дату', () => {
    expect(topicToggleLabel({ is_open: null, available_from: FUTURE }, TODAY)).toBe('Откроется 1.09')
  })

  it('день без ведущего нуля, месяц с ним', () => {
    expect(topicToggleLabel({ is_open: null, available_from: '2026-12-05' }, TODAY)).toBe('Откроется 5.12')
  })

  it('включённый тумблер при будущей дате — просто «Открыта»', () => {
    expect(topicToggleLabel({ is_open: true, available_from: FUTURE }, TODAY)).toBe('Открыта')
  })
})
