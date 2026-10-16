import { describe, expect, it } from 'vitest'
import { lessonTile, lockLine, openDate, sectionOpenLine, type ScreenTopic } from '@/lib/courseScreen'

// Условие открытия — строкой внизу плитки (письмо ЛК_стиль_открытие_урока_в_плитке.md, 16.10, вариант Б).
const TODAY = '2026-10-16' // пятница

const topic = (over: Partial<ScreenTopic> = {}): ScreenTopic => ({
  id: 't', title: 'Тема', is_open: null, available_from: null, hw_id: 'hw', hw_status: null, ...over,
})

describe('дата открытия', () => {
  it('«пн 19 окт» и «в понедельник, 19 октября»; на завтра — «завтра»', () => {
    expect(openDate('2026-10-19', TODAY)).toEqual({ short: 'пн 19 окт', long: 'в понедельник, 19 октября' })
    expect(openDate('2026-11-02', TODAY).short).toBe('пн 2 нояб')
    expect(openDate('2026-10-17', TODAY)).toEqual({ short: 'завтра', long: 'завтра, 17 октября' })
  })
})

describe('строка замка', () => {
  it('по датам: «🔒 откроется пн 19 окт», подсказка тем же условием', () => {
    expect(lockLine(topic({ available_from: '2026-10-19' }), TODAY)).toEqual({ short: '🔒 откроется пн 19 окт', tip: 'Урок откроется в понедельник, 19 октября' })
  })

  it('закрыт вручную без даты — «🔒 закрыт»; дата при ручном замке не обещается', () => {
    expect(lockLine(topic({ is_open: false }), TODAY).short).toBe('🔒 закрыт')
    expect(lockLine(topic({ is_open: false, available_from: '2026-10-19' }), TODAY).short).toBe('🔒 закрыт')
  })

  it('по прохождению: «🔒 после урока 7»; урок другого раздела — по названию', () => {
    const no = new Map([['t7', 7]])
    expect(lockLine(topic({ progress: { open: false, note: null, afterTopicId: 't7', afterTitle: 'Сила тяжести' } }), TODAY, no))
      .toEqual({ short: '🔒 после урока 7', tip: 'Откроется, когда пройдёшь урок 7 «Сила тяжести»' })
    expect(lockLine(topic({ progress: { open: false, note: null, afterTopicId: 'x', afterTitle: 'Импульс' } }), TODAY, no).short)
      .toBe('🔒 после «Импульс»')
  })

  it('демо подписки — «🔒 с подпиской»', () => {
    expect(lockLine(topic({ progress: { open: false, note: 'Доступно по подписке' } }), TODAY, undefined, 'Доступно по подписке').short)
      .toBe('🔒 с подпиской')
  })
})

describe('плитка урока', () => {
  it('статусы открытых: пройдено / на проверке / сдать ДЗ / без ДЗ', () => {
    expect(lessonTile(topic({ hw_status: 'accepted' }), TODAY).pill).toBe('✓ пройдено')
    expect(lessonTile(topic({ hw_status: 'submitted' }), TODAY).pill).toBe('ДЗ на проверке')
    expect(lessonTile(topic(), TODAY).pill).toBe('сдать ДЗ')
    expect(lessonTile(topic({ hw_id: null }), TODAY).pill).toBe('открыт · без ДЗ')
  })

  it('закрытая — условие и подсказка', () => {
    const t = lessonTile(topic({ available_from: '2026-10-19' }), TODAY)
    expect(t).toMatchObject({ state: 'locked', pill: '🔒 откроется пн 19 окт', tip: 'Урок откроется в понедельник, 19 октября' })
  })
})

describe('шапка раздела', () => {
  it('«открыто 5 из 8 · следующие 2 — пн 19 окт»', () => {
    const topics = [
      ...Array.from({ length: 5 }, (_, i) => topic({ id: `o${i}` })),
      topic({ id: 'a', available_from: '2026-10-19' }), topic({ id: 'b', available_from: '2026-10-19' }),
      topic({ id: 'c', available_from: '2026-10-26' }),
    ]
    expect(sectionOpenLine(topics, TODAY)).toBe('открыто 5 из 8 · следующие 2 — пн 19 окт')
  })

  it('будущих дат нет — только «открыто N из M»', () => {
    expect(sectionOpenLine([topic(), topic({ id: 'x', is_open: false })], TODAY)).toBe('открыто 1 из 2')
  })
})
