import { describe, expect, it } from 'vitest'
import { formatRelativeDay } from '@/lib/studentListData'

/**
 * Колонка активности показывает относительную дату (решение владельца 04.08).
 * Считаем по КАЛЕНДАРНЫМ дням, а не по «24 часа назад»: сдача вчера в 23:50 и
 * взгляд на список сегодня в 09:00 — это «вчера», а не «сегодня», хотя прошло
 * девять часов.
 */
describe('formatRelativeDay', () => {
  const now = new Date('2026-08-04T12:00:00')

  it('без сдач — так и пишет', () => {
    expect(formatRelativeDay(null, now)).toBe('нет сдач')
    expect(formatRelativeDay(undefined, now)).toBe('нет сдач')
    expect(formatRelativeDay('не дата', now)).toBe('нет сдач')
  })

  it('сегодня и вчера — словами', () => {
    expect(formatRelativeDay('2026-08-04T09:00:00', now)).toBe('сегодня')
    expect(formatRelativeDay('2026-08-03T23:50:00', now)).toBe('вчера')
  })

  it('поздний вечер вчера — всё ещё «вчера», а не «сегодня»', () => {
    const morning = new Date('2026-08-04T09:00:00')
    expect(formatRelativeDay('2026-08-03T23:50:00', morning)).toBe('вчера')
  })

  it('внутри недели — числом дней с правильным окончанием', () => {
    expect(formatRelativeDay('2026-08-02T10:00:00', now)).toBe('2 дня назад')
    expect(formatRelativeDay('2026-07-31T10:00:00', now)).toBe('4 дня назад')
    expect(formatRelativeDay('2026-07-30T10:00:00', now)).toBe('5 дней назад')
  })

  it('дальше недели — обычной датой: «12 дней назад» уже не читается быстрее', () => {
    expect(formatRelativeDay('2026-07-23T10:00:00', now)).toBe('23.07.2026')
  })
})

describe('Сортировка списка учеников', () => {
  it('по алфавиту с русской локалью: «Ё» на месте, регистр не значит', () => {
    const names = ['яковлев Пётр', 'Ёлкин Иван', 'Абрамов Сергей', 'Егоров Илья']
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'ru'))
    expect(sorted).toEqual(['Абрамов Сергей', 'Егоров Илья', 'Ёлкин Иван', 'яковлев Пётр'])
  })
})
