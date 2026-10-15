import { describe, expect, it } from 'vitest'
import { buildRoadmap, topicState, type RoadmapModuleIn, type RoadmapTopicIn } from '@/lib/courseRoadmap'
import { EMPTY_COUNTERS } from '@/lib/studentCourseCounters'

/**
 * «Календарь тем» в программе курса — дорожка по разделам (письмо
 * ЛК_стиль_календарь_в_программу_курса.md, 15.10, вариант «А»).
 */
const TODAY = '2026-10-15'
const t = (id: string, extra: Partial<RoadmapTopicIn> = {}): RoadmapTopicIn =>
  ({ id, title: `Тема ${id}`, is_open: true, available_from: null, hw_id: `hw-${id}`, hw_status: 'not_started', ...extra })
const mod = (id: string, topics: RoadmapTopicIn[], done: number, counted = topics.length): RoadmapModuleIn =>
  ({ id, title: `Раздел ${id}`, topics, counters: { ...EMPTY_COUNTERS, doneTopics: done, countedTopics: counted } })

describe('статус темы', () => {
  it('сдано/принято — пройдено; открыта с ДЗ — сдать ДЗ; без ДЗ — открыто; закрыта — замок', () => {
    expect(topicState(t('a', { hw_status: 'submitted' }), TODAY)).toBe('done')
    expect(topicState(t('a', { hw_status: 'accepted' }), TODAY)).toBe('done')
    expect(topicState(t('a', { hw_status: 'returned' }), TODAY)).toBe('hw')
    expect(topicState(t('a', { hw_id: null, hw_status: null }), TODAY)).toBe('open')
    expect(topicState(t('a', { is_open: null, available_from: '2026-10-27' }), TODAY)).toBe('locked')
    expect(topicState(t('a', { progress: { open: false, note: 'Откроется после урока «A»' } }), TODAY)).toBe('locked')
  })
})

describe('курс по прохождению (пробный период)', () => {
  const lock = (note: string) => ({ progress: { open: false, note } })
  const modules = [
    mod('1', [t('1a', { hw_status: 'accepted' }), t('1b', { hw_status: 'accepted' })], 2),
    mod('2', [
      t('2a', { hw_status: 'accepted' }),
      t('2b', { progress: { open: true, note: null } }),
      t('2c', { progress: { open: true, note: null } }),
      t('2d', lock('Откроется после урока «Тема 2c»')),
      t('2e', lock('Доступно по подписке')),
      t('2f', lock('Доступно по подписке')),
    ], 1),
    mod('3', [t('3a', lock('Доступно по подписке')), t('3b', lock('Доступно по подписке'))], 0),
  ]

  it('пройденный раздел — «готово», текущий — где есть ДЗ, закрытый — «после «…»»', () => {
    const r = buildRoadmap(modules, TODAY)
    expect(r.map(m => m.state)).toEqual(['done', 'current', 'locked'])
    expect(r[0].meta).toBe('пройден')
    expect(r[1].meta).toBe('идёт сейчас · пройдено 1 из 6')
    expect(r[1].hwToDo).toBe(2)
    expect(r[2].meta).toBe('после «Раздел 2»')
  })

  it('в развёрнутом разделе: открытые темы и не больше двух закрытых, пройденные — числом', () => {
    const cur = buildRoadmap(modules, TODAY)[1]
    expect(cur.visible.map(x => [x.id, x.state])).toEqual([['2b', 'hw'], ['2c', 'hw'], ['2d', 'locked'], ['2e', 'locked']])
    expect(cur.visible[2].note).toBe('Откроется после урока «Тема 2c»')
    expect(cur.visible[3].note).toBe('Доступно по подписке')
    expect(cur.moreLocked).toBe(1)
    expect(cur.done).toBe(1)
  })
})

describe('курс по расписанию', () => {
  it('у закрытых тем — дата открытия, у разделов — недели по датам тем', () => {
    const r = buildRoadmap([
      mod('1', [t('1a', { available_from: '2026-10-06' }), t('1b', { available_from: '2026-10-13' })], 0),
      mod('2', [t('2a', { is_open: null, available_from: '2026-10-27' }), t('2b', { is_open: null, available_from: '2026-11-03' })], 0),
    ], TODAY)
    expect(r[0].state).toBe('current')
    expect(r[1].state).toBe('locked')
    expect(r[1].meta).toBe('откроется 27 окт')
    expect(buildRoadmap([
      mod('x', [t('xa', { available_from: '2026-10-06' }), t('xb', { is_open: null, available_from: '2026-10-27' })], 0),
      mod('y', [t('ya', { available_from: '2026-10-01' }), t('yb', { available_from: '2026-10-08' })], 0),
    ], TODAY)[1].meta).toBe('пройдено 0 из 2 · 1 окт – 8 окт')
    const locked = buildRoadmap([mod('z', [t('za', { is_open: null, available_from: '2026-10-27' })], 0)], TODAY)[0]
    expect(locked.visible[0].note).toBe('Откроется 27 октября')
  })
})
