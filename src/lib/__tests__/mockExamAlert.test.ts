/**
 * §224.2. Что сказать ученику о пробниках одной строкой сверху, и что сказать
 * преподавателю у поля «Начало», если напоминания уже не уйдут.
 */
import { describe, expect, it } from 'vitest'
import {
  mockAlert, mockTitlePhrase, previewMockRows, startNoticeWarning, type MockLessonListRow,
} from '@/lib/mockExamLesson'

const MIN = 60_000
const NOW = Date.parse('2026-09-26T07:00:00Z') // 10:00 МСК

function row(id: string, startOffsetMin: number, extra: Partial<MockLessonListRow> = {}): MockLessonListRow {
  const s = NOW + startOffsetMin * MIN
  return {
    id, title: id, starts_at: new Date(s).toISOString(), ends_at: new Date(s + 240 * MIN).toISOString(),
    photos_until: new Date(s + 255 * MIN).toISOString(), duration_minutes: 240,
    submitted_at: null, has_work: false, notified: false, server_now: new Date(NOW).toISOString(), ...extra,
  }
}

describe('mockAlert', () => {
  it('идущий пробник — громко, с остатком до конца окна', () => {
    const a = mockAlert([row('№1', -233)], NOW)
    expect(a?.kind).toBe('open')
    expect(a?.exam.id).toBe('№1')
    expect(a?.leftMs).toBe(7 * MIN)
  })

  it('идущий важнее ближайшего, даже если ближайший стоит в списке первым', () => {
    expect(mockAlert([row('скоро', 30), row('идёт', -10)], NOW)?.exam.id).toBe('идёт')
  })

  it('сданный идущий — уже не главное действие; остаётся ближайший', () => {
    const a = mockAlert([row('сдан', -60, { submitted_at: new Date(NOW - MIN).toISOString(), has_work: true }), row('завтра', 20 * 60)], NOW)
    expect(a).toMatchObject({ kind: 'soon', exam: { id: 'завтра' }, leftMs: 20 * 60 * MIN })
  })

  it('ближайший — только если меньше суток; ближе из двух', () => {
    expect(mockAlert([row('через 2 дня', 48 * 60)], NOW)).toBeNull()
    expect(mockAlert([row('через 5 ч', 300), row('через 2 ч', 120)], NOW)?.exam.id).toBe('через 2 ч')
  })

  it('прошедшие и пустой список — ничего', () => {
    expect(mockAlert([row('был', -600)], NOW)).toBeNull()
    expect(mockAlert([], NOW)).toBeNull()
  })
})

describe('mockTitlePhrase', () => {
  it('«№1» → пробник «№1»; слово «пробник» второй раз не повторяется', () => {
    expect(mockTitlePhrase('№1')).toBe('пробник «№1»')
    expect(mockTitlePhrase('Пробник №3')).toBe('«Пробник №3»')
  })
})

describe('startNoticeWarning — напоминания в прошлое не ставятся', () => {
  const at = (offsetMin: number) => new Date(NOW + offsetMin * MIN).toISOString()
  it('время в прошлом или «на сейчас» — «Пробник начался» не уйдёт, «за час» тоже', () => {
    for (const off of [-30, 0, 1]) {
      const w = startNoticeWarning(at(off), NOW)
      expect(w).toContain('Уведомление «Пробник начался» не уйдёт — время уже наступило')
      expect(w).toContain('«за час»')
    }
  })
  it('меньше часа — не уйдёт только «за час», «начался» уйдёт в момент начала', () => {
    const w = startNoticeWarning(at(40), NOW)
    expect(w).toContain('Напоминание «за час» не уйдёт')
    expect(w).toContain('«Пробник начался» уйдёт в 10:40')
    expect(w).not.toContain('время уже наступило')
  })
  it('больше часа или время не задано — молчим', () => {
    expect(startNoticeWarning(at(61), NOW)).toBeNull()
    expect(startNoticeWarning(null, NOW)).toBeNull()
  })
})

describe('previewMockRows — предпросмотр персонала по расписанию', () => {
  it('окно из начала и длительности; прошедшие и без времени — не показываются', () => {
    const rows = previewMockRows([
      { id: 'a', title: '№1', group_id: 'g', starts_at: new Date(NOW - 233 * MIN).toISOString(), duration_minutes: 240, photo_grace_minutes: 15 },
      { id: 'b', title: 'без времени', group_id: 'g', starts_at: null, duration_minutes: 240, photo_grace_minutes: 15 },
      { id: 'c', title: 'был', group_id: 'g', starts_at: new Date(NOW - 300 * MIN).toISOString(), duration_minutes: 240, photo_grace_minutes: 15 },
    ], NOW)
    expect(rows.map(r => r.id)).toEqual(['a'])
    expect(rows[0]).toMatchObject({ has_work: false, notified: false, submitted_at: null, ends_at: new Date(NOW + 7 * MIN).toISOString() })
    expect(mockAlert(rows, NOW)?.kind).toBe('open')
  })
})
