import { describe, expect, it } from 'vitest'
import {
  clockOffset, emptyAnswers, formatCountdown, fromMskInput, lessonStatus, lessonStatusLabel,
  mockPhotoPath, mockSectionItems, parseKeyPaste, toMskInput,
} from '@/lib/mockExamLesson'

/**
 * §221. Экранная логика пробника-урока. Что принять, решает база по своему
 * now() — эти функции только показывают, и показывают от часов базы.
 */

// Пробник 18.10.2026: 10:00–14:00 по Москве, фото до 14:15.
const START = '2026-10-18T07:00:00.000Z'
const END = '2026-10-18T11:00:00.000Z'
const PHOTOS = '2026-10-18T11:15:00.000Z'
const at = (iso: string) => new Date(iso).getTime()
const base = { starts_at: START, ends_at: END, photos_until: PHOTOS, submitted_at: null, has_work: false, notified: false }

describe('lessonStatus — состояния у ученика по часам базы', () => {
  it('до начала → идёт → время вышло → на проверке', () => {
    expect(lessonStatus(base, at('2026-10-18T06:59:59Z'))).toBe('upcoming')
    expect(lessonStatus(base, at(START))).toBe('open')
    expect(lessonStatus(base, at('2026-10-18T10:59:59Z'))).toBe('open')
    expect(lessonStatus({ ...base, has_work: true }, at(END))).toBe('time_up')
    expect(lessonStatus({ ...base, has_work: true }, at(PHOTOS))).toBe('checking')
  })

  it('сдан раньше: «сдан», пока принимаются фото; потом «на проверке»', () => {
    const s = { ...base, submitted_at: '2026-10-18T08:14:00Z', has_work: true }
    expect(lessonStatus(s, at('2026-10-18T08:30:00Z'))).toBe('submitted')
    expect(lessonStatus(s, at('2026-10-18T11:10:00Z'))).toBe('submitted')
    expect(lessonStatus(s, at(PHOTOS))).toBe('checking')
  })

  it('ничего не прислал — «не сдан»; результат отправлен — «результат» при любых часах', () => {
    expect(lessonStatus(base, at('2026-10-19T00:00:00Z'))).toBe('missed')
    expect(lessonStatus({ ...base, notified: true }, at('2026-10-18T06:00:00Z'))).toBe('result')
  })

  it('подписи — по Москве, как в макете', () => {
    expect(lessonStatusLabel(base, at('2026-10-17T12:00:00Z'))).toBe('откроется 18.10 в 10:00')
    expect(lessonStatusLabel(base, at('2026-10-18T08:13:00Z'))).toBe('идёт, осталось 2:47')
    expect(lessonStatusLabel({ ...base, has_work: true }, at(PHOTOS))).toBe('на проверке')
  })
})

describe('часы устройства не решают', () => {
  it('смещение: часы телефона на час вперёд — таймер всё равно от базы', () => {
    const server = '2026-10-18T08:12:45.000Z'
    const phone = at(server) + 3600_000
    const off = clockOffset(server, phone)
    expect(off).toBe(-3600_000)
    expect(lessonStatus(base, phone + off)).toBe('open')
    expect(formatCountdown(at(END) - (phone + off))).toBe('2:47:15')
  })

  it('отсчёт не уходит в минус', () => {
    expect(formatCountdown(-5000)).toBe('0:00:00')
  })
})

describe('бланк: пустые ответы перед сдачей', () => {
  it('пустое и пробелы — пусто; номера с единицы', () => {
    expect(emptyAnswers(['12', '0,75', '', ' ', null, '4'], 7)).toEqual([3, 4, 5, 7])
  })
})

describe('ключ из Excel', () => {
  it('строкой (табы) и столбцом (переводы строк); хвостовой перевод строки Excel не считается', () => {
    expect(parseKeyPaste('12\t0,75\t-3', 12)?.answers.slice(0, 4)).toEqual(['12', '0,75', '-3', ''])
    expect(parseKeyPaste('12\r\n0,75\r\n-3\r\n', 3)).toEqual({ answers: ['12', '0,75', '-3'], extra: 0 })
  })

  it('пробел внутри ответа — не разделитель; лишнее считается', () => {
    expect(parseKeyPaste('13 31\t4\t5', 2)).toEqual({ answers: ['13 31', '4'], extra: 1 })
  })

  it('одно значение без табов — обычный ввод, не вставка блока', () => {
    expect(parseKeyPaste('0,75', 12)).toBeNull()
    expect(parseKeyPaste('0,75\n', 12)).toBeNull()
  })
})

describe('§224. раздел «Пробники»: идёт → ближайшие → прошедшие', () => {
  const H = 3600_000
  const now = at(START) + 2 * H // 12:00 МСК: пробник START идёт
  const ex = (id: string, startMs: number, extra: { submitted_at?: string | null; has_work?: boolean; notified?: boolean } = {}) => ({
    ...base, id,
    starts_at: new Date(startMs).toISOString(),
    ends_at: new Date(startMs + 4 * H).toISOString(),
    photos_until: new Date(startMs + 4 * H + 15 * 60_000).toISOString(),
    ...extra,
  })

  it('порядок и группы; главная кнопка — одна, у идущего', () => {
    const items = mockSectionItems([
      ex('past-old', now - 30 * 24 * H, { notified: true }),
      ex('soon-far', now + 7 * 24 * H),
      ex('running', at(START)),
      ex('past-new', now - 7 * 24 * H, { has_work: true }),
      ex('soon-near', now + 20 * H),
      ex('grace', now - 4 * H - 5 * 60_000, { submitted_at: new Date(now - 5 * H).toISOString() }),
    ], now)
    expect(items.map(i => [i.exam.id, i.group, i.status])).toEqual([
      ['grace', 'now', 'submitted'],
      ['running', 'now', 'open'],
      ['soon-near', 'upcoming', 'upcoming'],
      ['soon-far', 'upcoming', 'upcoming'],
      ['past-new', 'past', 'checking'],
      ['past-old', 'past', 'result'],
    ])
    expect(items.filter(i => i.primary).map(i => i.exam.id)).toEqual(['running'])
  })

  it('идущих два — главная кнопка всё равно одна', () => {
    const items = mockSectionItems([ex('a', at(START)), ex('b', at(START) + H)], now)
    expect(items.filter(i => i.primary)).toHaveLength(1)
  })

  it('ничего не идёт — главной кнопки нет', () => {
    expect(mockSectionItems([ex('x', now + H)], now).some(i => i.primary)).toBe(false)
  })
})

describe('время начала вводится по Москве', () => {
  it('туда и обратно', () => {
    expect(toMskInput(START)).toBe('2026-10-18T10:00')
    expect(fromMskInput('2026-10-18T10:00')).toBe(START)
    expect(fromMskInput('')).toBeNull()
    expect(fromMskInput('18.10.2026 10:00')).toBeNull()
  })
})

describe('путь фото', () => {
  it('пробник / photos / ученик / имя — на этих сегментах держится политика бакета', () => {
    expect(mockPhotoPath('E', 'S', 'стр 1.jpg', 42)).toMatch(/^E\/photos\/S\/42_[^/]+$/)
  })
})
