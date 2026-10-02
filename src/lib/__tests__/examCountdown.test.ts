import { describe, expect, it } from 'vitest'
import { daysUntil, examCountdown, examForCourses, mskDayOf } from '@/lib/examCountdown'

/** §255. Плашка «N дней до ЕГЭ»: счёт по московскому дню сервера, склонение, кому показывать. */
describe('дни до экзамена', () => {
  it('2 октября 2026 → 1 июня 2027: 242 дня, как в макете', () => {
    expect(daysUntil('2026-10-02', '2027-06-01')).toBe(242)
    expect(examCountdown('2026-10-02', ['ege'])).toMatchObject({
      exam: 'ege', days: 242, daysWord: 'дня', label: 'до ЕГЭ', note: 'примерно, до 1 июня',
    })
  })

  it('склонение: 1 день, 2 дня, 5 дней, 11 дней, 21 день', () => {
    const word = (today: string) => examCountdown(today, ['ege'])?.daysWord
    expect(word('2027-05-31')).toBe('день')   // 1
    expect(word('2027-05-30')).toBe('дня')    // 2
    expect(word('2027-05-27')).toBe('дней')   // 5
    expect(word('2027-05-21')).toBe('дней')   // 11
    expect(word('2027-05-11')).toBe('день')   // 21
  })

  it('в день экзамена (0) и после — плашки нет, а не «0 дней» / «−3 дня»', () => {
    expect(examCountdown('2027-06-01', ['ege'])).toBeNull()
    expect(examCountdown('2027-06-04', ['ege'])).toBeNull()
    expect(examCountdown('2027-05-31', ['ege'])?.days).toBe(1)
  })

  it('граница суток — по Москве: 23:30 UTC 1 октября — уже 2 октября', () => {
    expect(mskDayOf(new Date('2026-10-01T20:59:59Z'))).toBe('2026-10-01')
    expect(mskDayOf(new Date('2026-10-01T21:00:00Z'))).toBe('2026-10-02')
    expect(mskDayOf(new Date('2026-10-01T23:30:00Z'))).toBe('2026-10-02')
  })

  it('кому: ЕГЭ — «до ЕГЭ» (важнее ОГЭ), только ОГЭ — «до ОГЭ», иначе нет', () => {
    expect(examForCourses(['oge', 'ege'])).toBe('ege')
    expect(examCountdown('2026-10-02', ['oge'])).toMatchObject({ exam: 'oge', label: 'до ОГЭ', days: 242 })
    expect(examCountdown('2026-10-02', [null, undefined])).toBeNull()
    expect(examCountdown('2026-10-02', [])).toBeNull()
  })

  it('без «сегодня» сервера — плашки нет (часы устройства не берём)', () => {
    expect(examCountdown(null, ['ege'])).toBeNull()
    expect(examCountdown('вчера', ['ege'])).toBeNull()
  })
})
