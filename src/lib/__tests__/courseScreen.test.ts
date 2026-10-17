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

describe('по прохождению: дата ИЛИ после предыдущего (письмо 16.10)', () => {
  const no = new Map([['t3', 3]])
  const lock = (over: object) => topic({ progress: { open: false, note: null, ...over } })

  it('есть дата и предыдущий — «🔒 пн 19 окт или после урока 3», на телефоне короче, подсказка «или раньше»', () => {
    expect(lockLine(lock({ afterTopicId: 't3', afterTitle: 'Масса', opensOn: '2026-10-19' }), TODAY, no)).toEqual({
      short: '🔒 пн 19 окт или после урока 3',
      compact: '🔒 19 окт · или после ур. 3',
      tip: 'Откроется в понедельник, 19 октября — или раньше, как только пройдёшь урок 3 «Масса»',
    })
  })

  it('даты нет — «🔒 после урока 3»; ни даты, ни предыдущего — «🔒 закрыт»', () => {
    expect(lockLine(lock({ afterTopicId: 't3' }), TODAY, no).short).toBe('🔒 после урока 3')
    expect(lockLine(lock({}), TODAY, no).short).toBe('🔒 закрыт')
  })

  it('шапка раздела без числа: «открыто 1 из 2 · следующие — пн 19 окт»', () => {
    expect(sectionOpenLine([topic({ id: 'a', progress: { open: true, note: null } }), lock({ opensOn: '2026-10-19' })], TODAY))
      .toBe('открыто 1 из 2 · следующие — пн 19 окт')
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

describe('ручное открытие главнее даты (письмо 17.10, topic_open_now)', () => {
  it('is_open = true + дата в будущем — открыт, без замка; null + будущая — замок с датой; false — «🔒 закрыт»', () => {
    expect(lessonTile(topic({ is_open: true, available_from: '2027-02-22' }), TODAY)).toMatchObject({ state: 'hw', pill: 'сдать ДЗ' })
    expect(lessonTile(topic({ is_open: null, available_from: '2026-10-19' }), TODAY)).toMatchObject({ state: 'locked', pill: '🔒 откроется пн 19 окт' })
    expect(lessonTile(topic({ is_open: false, available_from: '2026-10-19' }), TODAY)).toMatchObject({ state: 'locked', pill: '🔒 закрыт' })
  })

  it('шапка раздела и плитка раздела: открытая вручную тема не даёт «откроется <дата>»', () => {
    const ts = [topic({ id: 'a', is_open: true, available_from: '2027-02-22' }), topic({ id: 'b', is_open: true, available_from: '2027-03-01' })]
    expect(sectionOpenLine(ts, TODAY)).toBe('открыто 2 из 2')
  })
})
