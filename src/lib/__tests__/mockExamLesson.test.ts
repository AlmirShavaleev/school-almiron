import { describe, expect, it } from 'vitest'
import {
  clockOffset, emptyAnswers, formatCountdown, fromMskInput, lessonStatus, lessonStatusLabel,
  mockPhotoPath, parseKeyPaste, placeInModule, toMskInput,
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

describe('место в разделе', () => {
  const topics = [{ id: 't1', order_index: 1 }, { id: 't2', order_index: 2 }, { id: 't3', order_index: 5 }]
  const ex = (id: string, module_position: number) => ({ id, module_position, starts_at: START })

  it('после последней темы с order_index <= позиции; меньше всех — первым; больше всех — последним', () => {
    const order = placeInModule(topics, [ex('m2', 2), ex('m0', -1), ex('m9', 9), ex('m4', 4)])
      .map(i => (i.kind === 'topic' ? i.topic.id : i.exam.id))
    expect(order).toEqual(['m0', 't1', 't2', 'm2', 'm4', 't3', 'm9'])
  })

  it('без тем пробник всё равно виден', () => {
    expect(placeInModule([], [ex('m', 0)]).map(i => i.kind)).toEqual(['exam'])
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
