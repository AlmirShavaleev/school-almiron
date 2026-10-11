/**
 * §288. Тексты и применение замков «по прохождению» на клиенте: подпись под
 * замком, правило открытости (`isTopicOpen` уступает решению базы), карточка
 * урока, «Открыт урок «…»», подсказки ячеек «Прохождения», «застрявшие».
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  cellHint,
  isStuck,
  openedMessage,
  progressNote,
  takeNewlyOpened,
  withProgressLocks,
  type CourseTopicLocks,
  type TopicLock,
} from '../progressUnlock'
import { isTopicOpen, topicClosedLabel } from '../topicAvailability'

const lock = (p: Partial<TopicLock>): TopicLock => ({
  topic_id: 't', title: 'Урок', open: false, reason: null, closed: false, percent: null,
  after_topic_id: null, after_title: null, opens_on: null, ...p,
})

afterEach(() => localStorage.clear())

describe('progressNote — подпись под замком', () => {
  const today = '2026-10-11'
  it('после урока, после урока или дата, только дата, позже; открытый — без подписи', () => {
    expect(progressNote(lock({ after_title: 'Импульс' }), today)).toBe('Откроется после урока «Импульс»')
    expect(progressNote(lock({ after_title: 'Импульс', opens_on: '2026-10-20' }), today))
      .toBe('Откроется после урока «Импульс» или 20 октября')
    expect(progressNote(lock({ opens_on: '2026-11-01' }), today)).toBe('Откроется 1 ноября')
    expect(progressNote(lock({}), today)).toBe('Откроется позже')
    // прошедшая дата урок уже открыла бы — в подписи её нет
    expect(progressNote(lock({ after_title: 'A', opens_on: '2026-10-01' }), today)).toBe('Откроется после урока «A»')
    expect(progressNote(lock({ open: true, after_title: 'A' }), today)).toBeNull()
  })
})

describe('решение базы важнее дат на клиенте', () => {
  it('isTopicOpen / topicClosedLabel: progress сильнее is_open и даты', () => {
    const t = { is_open: true, available_from: null }
    expect(isTopicOpen({ ...t, progress: { open: false, note: 'Откроется после урока «A»' } })).toBe(false)
    expect(topicClosedLabel({ ...t, progress: { open: false, note: 'Откроется после урока «A»' } })).toBe('Откроется после урока «A»')
    expect(isTopicOpen({ is_open: false, available_from: null, progress: { open: true, note: null } })).toBe(true)
    // без progress — прежнее правило
    expect(isTopicOpen({ is_open: false, available_from: null })).toBe(false)
  })

  it('withProgressLocks: курс по датам — без изменений; по прохождению — поле progress у каждой темы', () => {
    const topics = [{ id: 'a' }, { id: 'b' }]
    expect(withProgressLocks(topics, { mode: 'schedule', topics: [] })).toBe(topics)
    expect(withProgressLocks(topics, null)).toBe(topics)
    const out = withProgressLocks(topics, {
      mode: 'progress',
      topics: [lock({ topic_id: 'a', open: true, reason: 'first2' }), lock({ topic_id: 'b', after_title: 'A' })],
    })
    expect(out[0].progress).toEqual({ open: true, note: null })
    expect(out[1].progress).toEqual({ open: false, note: 'Откроется после урока «A»' })
  })
})

describe('«Открыт урок «…»» — по сравнению с прошлым визитом', () => {
  const locks = (open: Array<[string, TopicLock['reason']]>): CourseTopicLocks => ({
    mode: 'progress', topics: open.map(([id, reason]) => lock({ topic_id: id, title: `Урок ${id}`, open: true, reason })),
  })
  it('первый визит — молча запоминаем; потом — новые, кроме «первых двух»', () => {
    expect(takeNewlyOpened('c', 'p', locks([['1', 'first2'], ['2', 'first2']]))).toEqual([])
    const fresh = takeNewlyOpened('c', 'p', locks([['1', 'first2'], ['2', 'first2'], ['3', 'prev_closed']]))
    expect(fresh.map((l) => l.topic_id)).toEqual(['3'])
    // тот же набор — второй раз не сообщаем
    expect(takeNewlyOpened('c', 'p', locks([['1', 'first2'], ['2', 'first2'], ['3', 'prev_closed']]))).toEqual([])
    // другой ученик в том же браузере — свой счёт
    expect(takeNewlyOpened('c', 'other', locks([['1', 'first2']]))).toEqual([])
  })
  it('превью персонала и курс по датам — никогда', () => {
    expect(takeNewlyOpened('c', 'p', { ...locks([['1', 'date']]), preview: true })).toEqual([])
    expect(takeNewlyOpened('c', 'p', { mode: 'schedule', topics: [] })).toEqual([])
  })
  it('openedMessage', () => {
    expect(openedMessage([])).toBeNull()
    expect(openedMessage(['Импульс'])).toBe('Открыт урок «Импульс»')
    expect(openedMessage(['A', 'B'])).toBe('Открыты уроки: «A», «B»')
  })
})

describe('«Прохождение»: подсказка ячейки и «застрявшие»', () => {
  it('закрыт с %, заблокирован, открыт и чего не хватает, вручную', () => {
    expect(cellHint(['closed', 'first2', 0, 'accepted', 85, null])).toBe('урок закрыт, 85 %')
    expect(cellHint(['locked', null, 4, 'none', null, null])).toBe('заблокирован: не закрыт предыдущий урок; осталось задач автопроверки: 4')
    expect(cellHint(['locked', null, 0, 'none', null, 'closed'])).toBe('закрыт вручную')
    expect(cellHint(['open', 'prev_closed', 2, 'none', null, null])).toBe('открыт: закрыт предыдущий урок; осталось задач автопроверки: 2')
    expect(cellHint(['open', 'date', 0, 'none', null, null])).toBe('открыт: наступила дата урока; ДЗ не сдано')
    expect(cellHint(['pending_review', 'first2', 0, 'submitted', null, null])).toBe('открыт: один из первых двух уроков раздела; ДЗ на проверке')
    expect(cellHint(['open', 'manual', 0, 'returned', null, 'open'])).toBe('открыт вручную; ДЗ возвращено на доработку')
  })
  it('isStuck: никогда не закрывал или давно', () => {
    const now = new Date('2026-10-11T12:00:00Z')
    expect(isStuck({ last_closed_at: null }, 7, now)).toBe(true)
    expect(isStuck({ last_closed_at: '2026-10-01T12:00:00Z' }, 7, now)).toBe(true)
    expect(isStuck({ last_closed_at: '2026-10-08T12:00:00Z' }, 7, now)).toBe(false)
  })
})
