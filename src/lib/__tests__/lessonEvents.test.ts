import { beforeEach, describe, expect, it } from 'vitest'
import { detectEvent, lessonNumbers, openedTitle, snapshotOf, takeLessonEvent } from '@/lib/lessonEvents'
import type { ScreenModule, ScreenTopic } from '@/lib/courseScreen'

// Модалка «Урок пройден / открыт следующий» (письмо 16.10): четыре ситуации и «один раз на событие».
const TODAY = '2026-10-16'
const t = (id: string, over: Partial<ScreenTopic> = {}): ScreenTopic => ({
  id, title: `Тема ${id}`, is_open: null, available_from: null, hw_id: `hw-${id}`, hw_status: null, ...over,
})
const mod = (id: string, topics: ScreenTopic[]): ScreenModule => ({ id, title: `Раздел ${id}`, topics })

describe('detectEvent', () => {
  it('первый заход — ничего (только запоминаем)', () => {
    expect(detectEvent(null, [mod('m', [t('a', { hw_status: 'submitted' })])], TODAY)).toBeNull()
  })

  it('1. урок пройден — следующий открыт', () => {
    const ms = [mod('m', [t('a', { hw_status: 'submitted' }), t('b')])]
    const ev = detectEvent({ done: [], open: ['a', 'b'] }, ms, TODAY)
    expect(ev).toMatchObject({ kind: 'next', passed: { n: 1 }, next: { n: 2, foot: 'сдать ДЗ', locked: false } })
  })

  it('2. открытые уроки раздела сделаны — следующий по дате', () => {
    const ms = [mod('m', [t('a', { hw_status: 'accepted' }), t('b', { hw_status: 'submitted' }), t('c', { available_from: '2026-10-19' })])]
    const ev = detectEvent({ done: ['a'], open: ['a', 'b'] }, ms, TODAY)
    expect(ev).toMatchObject({ kind: 'wait', passed: { n: 2 }, next: { n: 3, foot: '🔒 откроется пн 19 окт', locked: true }, when: 'в понедельник' })
  })

  it('2→1: в разделе ещё есть открытый несданный — ведём к ближайшему', () => {
    const ms = [mod('m', [t('a'), t('b', { hw_status: 'submitted' }), t('c', { available_from: '2026-10-19' })])]
    const ev = detectEvent({ done: [], open: ['a', 'b'] }, ms, TODAY)
    expect(ev).toMatchObject({ kind: 'next', next: { n: 1 } })
  })

  it('3. открылись новые уроки — список и дата следующих', () => {
    const ms = [mod('m', [t('a'), t('b'), t('c', { available_from: '2026-10-26' })])]
    const ev = detectEvent({ done: [], open: [] }, ms, TODAY)
    expect(ev).toMatchObject({ kind: 'opened', moduleTitle: 'Раздел m', nextDate: 'пн 26 окт' })
    expect(ev?.kind === 'opened' && ev.lessons.map(l => l.n)).toEqual([1, 2])
  })

  it('4. пройден последний урок раздела — следующий раздел', () => {
    const ms = [mod('m', [t('a', { hw_status: 'accepted' }), t('b', { hw_status: 'submitted' })]), mod('n', [t('x')])]
    const ev = detectEvent({ done: ['a'], open: ['a', 'b', 'x'] }, ms, TODAY)
    expect(ev).toMatchObject({ kind: 'section', moduleTitle: 'Раздел m', count: 2, nextModuleTitle: 'Раздел n', next: { id: 'x' } })
  })

  it('с закрытыми уроками раздел не «пройден» (их ДЗ ученику не видно)', () => {
    const ms = [mod('m', [t('a', { hw_status: 'submitted' }), t('b', { hw_id: null, is_open: false })])]
    const ev = detectEvent({ done: [], open: ['a'] }, ms, TODAY)
    expect(ev?.kind).toBe('wait')
  })
})

describe('один раз на событие', () => {
  beforeEach(() => localStorage.clear())

  it('первый раз — запомнили; событие — один раз, повтор — ничего', () => {
    const before = [mod('m', [t('a'), t('b')])]
    expect(takeLessonEvent('p', 'c', before, TODAY)).toBeNull()
    const after = [mod('m', [t('a', { hw_status: 'submitted' }), t('b')])]
    expect(takeLessonEvent('p', 'c', after, TODAY)?.kind).toBe('next')
    expect(takeLessonEvent('p', 'c', after, TODAY)).toBeNull()
  })

  it('снимок — засчитанные и открытые', () => {
    expect(snapshotOf([mod('m', [t('a', { hw_status: 'accepted' }), t('b', { is_open: false })])], TODAY)).toEqual({ done: ['a'], open: ['a'] })
  })
})

describe('тексты', () => {
  it('номера и заголовок', () => {
    expect(lessonNumbers([6, 7, 8, 9, 10])).toBe('уроки 6–10')
    expect(lessonNumbers([4, 5, 7])).toBe('уроки 4, 5, 7')
    expect(openedTitle(1)).toBe('Открылся 1 новый урок')
    expect(openedTitle(5)).toBe('Открылись 5 новых уроков')
  })
})
