import { describe, it, expect } from 'vitest'
import {
  dedupeViewers,
  parsePresenceState,
  reviewChannelTopic,
  viewersLabel,
  viewersOfAttempt,
  type PresenceMeta,
} from '@/lib/reviewPresence'

const ANNA = 'aaaaaaaa-0000-0000-0000-000000000001'
const BORIS = 'bbbbbbbb-0000-0000-0000-000000000002'
const SELF = 'cccccccc-0000-0000-0000-000000000003'
const ATTEMPT = 'dddddddd-0000-0000-0000-000000000004'
const OTHER_ATTEMPT = 'eeeeeeee-0000-0000-0000-000000000005'

/** Форма, в которой состояние отдаёт realtime-js: ключ → массив метаданных. */
function state(entries: Record<string, unknown[]>) {
  return entries
}

describe('parsePresenceState', () => {
  it('разворачивает состояние канала в плоский список', () => {
    const metas = parsePresenceState(
      state({
        [ANNA]: [{ profileId: ANNA, name: 'Аня', attemptId: ATTEMPT, presence_ref: 'x1' }],
        [BORIS]: [{ profileId: BORIS, name: 'Борис', attemptId: null, presence_ref: 'x2' }],
      }),
    )
    expect(metas).toEqual([
      { profileId: ANNA, name: 'Аня', attemptId: ATTEMPT },
      { profileId: BORIS, name: 'Борис', attemptId: null },
    ])
  })

  it('пропускает мусор с провода, но не теряет соседние записи', () => {
    const metas = parsePresenceState(
      state({
        broken: [null, 'строка', { name: 'без профиля' }, 42],
        [ANNA]: [{ profileId: ANNA, name: 'Аня', attemptId: ATTEMPT }],
      }),
    )
    expect(metas).toEqual([{ profileId: ANNA, name: 'Аня', attemptId: ATTEMPT }])
  })

  it('подставляет запасное имя вместо пустого', () => {
    const metas = parsePresenceState(state({ [ANNA]: [{ profileId: ANNA, name: '   ', attemptId: null }] }))
    expect(metas[0].name).toBe('Коллега')
  })

  it('не падает на пустом и нестандартном состоянии', () => {
    expect(parsePresenceState(null)).toEqual([])
    expect(parsePresenceState(undefined)).toEqual([])
    expect(parsePresenceState('нет')).toEqual([])
    expect(parsePresenceState(state({ [ANNA]: 'не массив' as any }))).toEqual([])
  })
})

describe('dedupeViewers', () => {
  it('убирает себя из списка', () => {
    const metas: PresenceMeta[] = [
      { profileId: SELF, name: 'Я', attemptId: ATTEMPT },
      { profileId: ANNA, name: 'Аня', attemptId: ATTEMPT },
    ]
    expect(dedupeViewers(metas, SELF)).toEqual([{ profileId: ANNA, name: 'Аня', attemptId: ATTEMPT }])
  })

  it('схлопывает две вкладки одного человека и оставляет ту, где работа открыта', () => {
    const metas: PresenceMeta[] = [
      { profileId: ANNA, name: 'Аня', attemptId: null },
      { profileId: ANNA, name: 'Аня', attemptId: ATTEMPT },
    ]
    expect(dedupeViewers(metas, SELF)).toEqual([{ profileId: ANNA, name: 'Аня', attemptId: ATTEMPT }])
  })

  it('порядок вкладок не важен — «внутри работы» всё равно побеждает', () => {
    const metas: PresenceMeta[] = [
      { profileId: ANNA, name: 'Аня', attemptId: ATTEMPT },
      { profileId: ANNA, name: 'Аня', attemptId: null },
    ]
    expect(dedupeViewers(metas, SELF)).toEqual([{ profileId: ANNA, name: 'Аня', attemptId: ATTEMPT }])
  })

  it('без известного профиля себя не вычитает', () => {
    const metas: PresenceMeta[] = [{ profileId: ANNA, name: 'Аня', attemptId: null }]
    expect(dedupeViewers(metas, null)).toHaveLength(1)
  })
})

describe('viewersOfAttempt', () => {
  it('оставляет только тех, кто внутри этой работы', () => {
    const viewers: PresenceMeta[] = [
      { profileId: ANNA, name: 'Аня', attemptId: ATTEMPT },
      { profileId: BORIS, name: 'Борис', attemptId: OTHER_ATTEMPT },
      { profileId: SELF, name: 'Кто-то', attemptId: null },
    ]
    expect(viewersOfAttempt(viewers, ATTEMPT).map(v => v.name)).toEqual(['Аня'])
  })
})

describe('viewersLabel', () => {
  it('молчит, когда никого нет', () => {
    expect(viewersLabel([])).toBe('')
  })

  it('называет одного и двоих поимённо', () => {
    expect(viewersLabel([{ profileId: ANNA, name: 'Аня', attemptId: ATTEMPT }])).toBe('Смотрит: Аня')
    expect(
      viewersLabel([
        { profileId: ANNA, name: 'Аня', attemptId: ATTEMPT },
        { profileId: BORIS, name: 'Борис', attemptId: ATTEMPT },
      ]),
    ).toBe('Смотрят: Аня, Борис')
  })

  it('после двух имён переходит на счёт', () => {
    const many: PresenceMeta[] = ['Аня', 'Борис', 'Вера', 'Глеб'].map((name, i) => ({
      profileId: `${i}`,
      name,
      attemptId: ATTEMPT,
    }))
    expect(viewersLabel(many)).toBe('Смотрят: Аня, Борис и ещё 2')
  })
})

describe('reviewChannelTopic', () => {
  it('совпадает с шаблоном, который проверяет политика realtime.messages', () => {
    const courseId = 'ee299d72-7928-4f5b-ba90-06692ea43ba1'
    const topic = reviewChannelTopic(courseId)
    expect(topic).toBe(`hw-review:${courseId}`)
    // ^hw-review:<uuid>$ — ровно это разбирает realtime_review_topic_course.
    expect(topic).toMatch(/^hw-review:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/)
  })
})
