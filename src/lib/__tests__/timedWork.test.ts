import { describe, expect, it } from 'vitest'
import {
  TOPIC_KIND_LABEL, WORK_KIND_FILTER_KEY, WORK_KIND_TAG,
  countByKind, durationLabel, filterByKind, formatCountdown, formatMoscowDay, formatMoscowShort,
  formatMoscowTime, isTimedKind, isTimerWarning, moscowParts, moscowToIso, normalizeTopicKind,
  parseTimedSummary, parseWindowDraft, readStoredKindFilter, serverOffsetMs, storeKindFilter,
  submittedLabel, timedPhase, windowDraftOf,
} from '../timedWork'

/**
 * §240. Работа по времени: тип темы, окно по Москве, отсчёт, состояние
 * ученика, фильтр очереди. Поведение, а не текст исходника.
 */

describe('тип темы', () => {
  it('нет столбца или мусор — урок; проверочная и контрольная — работа по времени', () => {
    expect(normalizeTopicKind(undefined)).toBe('lesson')
    expect(normalizeTopicKind('exam')).toBe('lesson')
    expect(normalizeTopicKind('check')).toBe('check')
    expect(isTimedKind('lesson')).toBe(false)
    expect(isTimedKind(null)).toBe(false)
    expect(isTimedKind('check')).toBe(true)
    expect(isTimedKind('control')).toBe(true)
  })

  it('проверочная и контрольная отличаются только названием', () => {
    expect(TOPIC_KIND_LABEL.check).toBe('Проверочная работа')
    expect(TOPIC_KIND_LABEL.control).toBe('Контрольная работа')
    expect(WORK_KIND_TAG).toEqual({ lesson: 'ДЗ', check: 'Проверочная', control: 'КР' })
  })
})

describe('время по Москве', () => {
  // 07:00 UTC = 10:00 МСК
  const TEN = '2026-10-02T07:00:00.000Z'

  it('показ — по Москве, а не по часовому поясу устройства', () => {
    expect(formatMoscowTime(TEN)).toBe('10:00')
    expect(formatMoscowDay(TEN)).toBe('пт, 2 октября')
    expect(formatMoscowShort(TEN)).toMatch(/^пт 2 окт, 10:00$/)
    expect(formatMoscowTime(null)).toBe('')
  })

  it('поля «дата + время по Москве» ↔ момент', () => {
    expect(moscowToIso('2026-10-02', '10:00')).toBe(TEN)
    expect(moscowParts(TEN)).toEqual({ date: '2026-10-02', time: '10:00' })
    // полночь по Москве — ещё вчера по UTC
    expect(moscowToIso('2026-10-02', '00:30')).toBe('2026-10-01T21:30:00.000Z')
    expect(moscowParts('2026-10-01T21:30:00.000Z')).toEqual({ date: '2026-10-02', time: '00:30' })
    expect(moscowToIso('2026-10-02', '')).toBeNull()
    expect(moscowToIso('2.10.2026', '10:00')).toBeNull()
  })

  it('окно учителя: пусто, неполно, закрытие раньше открытия, верно', () => {
    expect(parseWindowDraft({ date: '', opens: '', closes: '' })).toEqual({ kind: 'empty' })
    expect(parseWindowDraft({ date: '2026-10-02', opens: '10:00', closes: '' })).toEqual({ kind: 'incomplete' })
    expect(parseWindowDraft({ date: '2026-10-02', opens: '10:45', closes: '10:00' }).kind).toBe('invalid')
    expect(parseWindowDraft({ date: '2026-10-02', opens: '10:00', closes: '10:00' }).kind).toBe('invalid')
    expect(parseWindowDraft({ date: '2026-10-02', opens: '10:00', closes: '10:45' })).toEqual({
      kind: 'ok', opensAt: TEN, closesAt: '2026-10-02T07:45:00.000Z',
    })
    expect(windowDraftOf(TEN, '2026-10-02T07:45:00.000Z')).toEqual({ date: '2026-10-02', opens: '10:00', closes: '10:45' })
    expect(windowDraftOf(null, null)).toEqual({ date: '', opens: '', closes: '' })
  })

  it('длительность словами', () => {
    expect(durationLabel(TEN, '2026-10-02T07:45:00.000Z')).toBe('45 минут')
    expect(durationLabel(TEN, '2026-10-02T07:01:00.000Z')).toBe('1 минута')
    expect(durationLabel(TEN, '2026-10-02T09:00:00.000Z')).toBe('2 часа')
    expect(durationLabel(TEN, '2026-10-02T08:30:00.000Z')).toBe('1 ч 30 мин')
    expect(durationLabel(TEN, TEN)).toBe('')
    expect(durationLabel(null, TEN)).toBe('')
  })
})

describe('отсчёт и таймер', () => {
  it('формат: минуты, часы, дни; прошлое — нули', () => {
    expect(formatCountdown((32 * 60 + 14) * 1000)).toBe('32:14')
    expect(formatCountdown((3600 + 2 * 60 + 3) * 1000)).toBe('1:02:03')
    expect(formatCountdown((86400 + 3 * 3600 + 12 * 60 + 40) * 1000)).toBe('1 д 03:12:40')
    expect(formatCountdown(-5000)).toBe('00:00')
  })

  it('доли секунды округляются вверх — «00:00» не раньше сервера', () => {
    expect(formatCountdown(400)).toBe('00:01')
  })

  it('за 5 минут до конца — красный, после конца — нет', () => {
    expect(isTimerWarning(6 * 60e3)).toBe(false)
    expect(isTimerWarning(5 * 60e3)).toBe(true)
    expect(isTimerWarning(1000)).toBe(true)
    expect(isTimerWarning(0)).toBe(false)
  })

  it('разница с сервером — по середине запроса, часы телефона не решают', () => {
    // телефон отстаёт на 90 с; запрос шёл 200 мс
    const sent = Date.parse('2026-10-02T06:58:30.000Z')
    const received = sent + 200
    const server = '2026-10-02T07:00:00.100Z'
    expect(serverOffsetMs(server, sent, received)).toBe(90_000)
    expect(serverOffsetMs(null, sent, received)).toBe(0)
  })
})

describe('состояние ученика — пять экранов макета', () => {
  const opensAt = '2026-10-02T07:00:00.000Z'
  const closesAt = '2026-10-02T07:45:00.000Z'
  const at = (iso: string) => Date.parse(iso)
  const base = { opensAt, closesAt, attemptStatus: null, draftFiles: 0 } as const

  it('до начала → идёт → закрыто', () => {
    expect(timedPhase({ ...base, nowMs: at('2026-10-02T06:59:59.000Z') })).toBe('before')
    expect(timedPhase({ ...base, nowMs: at(opensAt) })).toBe('live')
    expect(timedPhase({ ...base, nowMs: at(closesAt) })).toBe('missed')
  })

  it('закрылось с фото в черновике — «сдаётся автоматически», без фото — «не сдано»', () => {
    const now = at('2026-10-02T07:45:10.000Z')
    expect(timedPhase({ ...base, attemptStatus: 'draft', draftFiles: 2, nowMs: now })).toBe('sending')
    expect(timedPhase({ ...base, attemptStatus: 'draft', draftFiles: 0, nowMs: now })).toBe('missed')
  })

  it('сдано и проверено — независимо от окна; возврат (наследие) — тоже «проверено»', () => {
    const now = at('2026-10-02T07:10:00.000Z')
    expect(timedPhase({ ...base, attemptStatus: 'submitted', nowMs: now })).toBe('sent')
    expect(timedPhase({ ...base, attemptStatus: 'accepted', nowMs: now })).toBe('done')
    expect(timedPhase({ ...base, attemptStatus: 'returned_for_revision', nowMs: now })).toBe('done')
  })

  it('окна нет — «время не назначено», а сданная работа без окна — «сдано»', () => {
    expect(timedPhase({ ...base, opensAt: null, closesAt: null, nowMs: 0 })).toBe('unscheduled')
    expect(timedPhase({ ...base, opensAt: null, closesAt: null, attemptStatus: 'submitted', nowMs: 0 })).toBe('sent')
  })

  it('подпись сдачи: сам или автоматически', () => {
    expect(submittedLabel('2026-10-02T07:41:00.000Z', false)).toBe('сдано в 10:41')
    expect(submittedLabel(closesAt, true)).toBe('сдано автоматически в 10:45')
    expect(submittedLabel(null, true)).toBe('')
  })
})

describe('сводка учителю', () => {
  it('числа приходят и строкой (bigint), мусор — null', () => {
    expect(parseTimedSummary({ in_class: '21', submitted_self: 17, submitted_auto: '2', not_submitted: 2, personal_windows: 0, closed: true, closes_at: '2026-10-02T07:45:00Z' }))
      .toEqual({ inClass: 21, submittedSelf: 17, submittedAuto: 2, notSubmitted: 2, personalWindows: 0, closed: true, closesAt: '2026-10-02T07:45:00Z' })
    expect(parseTimedSummary(null)).toBeNull()
  })
})

describe('очередь: плашка и фильтр по типу', () => {
  const rows = [
    { id: 1, topicKind: 'control' as const }, { id: 2, topicKind: 'check' as const },
    { id: 3, topicKind: 'lesson' as const }, { id: 4 }, { id: 5, topicKind: 'control' as const },
  ]

  it('счётчики: работа без типа — ДЗ урока', () => {
    expect(countByKind(rows)).toEqual({ all: 5, lesson: 2, check: 1, control: 2 })
  })

  it('фильтр', () => {
    expect(filterByKind(rows, 'all').map(r => r.id)).toEqual([1, 2, 3, 4, 5])
    expect(filterByKind(rows, 'control').map(r => r.id)).toEqual([1, 5])
    expect(filterByKind(rows, 'lesson').map(r => r.id)).toEqual([3, 4])
  })

  it('запоминается в localStorage; недоступное хранилище — не ошибка', () => {
    const mem = new Map<string, string>()
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) } }
    expect(readStoredKindFilter(storage)).toBe('all')
    storeKindFilter(storage, 'control')
    expect(mem.get(WORK_KIND_FILTER_KEY)).toBe('control')
    expect(readStoredKindFilter(storage)).toBe('control')
    mem.set(WORK_KIND_FILTER_KEY, 'junk')
    expect(readStoredKindFilter(storage)).toBe('all')
    const broken = { getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceeded') } }
    expect(readStoredKindFilter(broken)).toBe('all')
    expect(() => storeKindFilter(broken, 'check')).not.toThrow()
    expect(readStoredKindFilter(null)).toBe('all')
  })
})
