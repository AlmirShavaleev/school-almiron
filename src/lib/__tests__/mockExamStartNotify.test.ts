/**
 * §224. Напоминания ученикам о пробнике: «через час» и «начался».
 *
 * Карточки собирает `process-notification-queue` через
 * `_shared/variant-telegram.ts` — здесь проверяются настоящие функции из
 * этого файла, а не копии. Payload — тот, что кладёт триггер
 * `mock_exam_schedule_notifications` (PENDING_224.sql).
 */
import { describe, expect, it } from 'vitest'
import {
  buildMockExamSoonTelegramMessage,
  buildMockExamStartTelegramMessage,
  formatClockMsk,
  isTelegramPreferenceEnabled,
} from '../../../supabase/functions/_shared/variant-telegram'

// 10:00–14:00 по Москве, фото до 14:15 (UTC+3).
const payload = {
  title: 'Пробник №3',
  starts_at: '2026-10-18T07:00:00+00:00',
  ends_at: '2026-10-18T11:00:00+00:00',
  photos_until: '2026-10-18T11:15:00+00:00',
  link: '/my-course/g-1/mock/e-1',
  button_text: 'Открыть пробник',
}

describe('Telegram-карточка mock_exam_soon — за час до начала', () => {
  it('ровно текст владельца: заголовок, название и окно по Москве, что взять с собой', () => {
    const { text, replyMarkup } = buildMockExamSoonTelegramMessage(payload)
    expect(text).toBe(
      '⏰ <b>Через час — пробник</b>\n\n' +
      '«Пробник №3» · 10:00–14:00\n' +
      'Нужны черновик, ручка и телефон для фото второй части',
    )
    expect(replyMarkup).toBeNull()
  })

  it('название экранируется; без времени — строка без окна, а не «Invalid Date»', () => {
    const { text } = buildMockExamSoonTelegramMessage({ title: 'x < y & z', starts_at: 'мусор' })
    expect(text).toContain('«x &lt; y &amp; z»\n')
    expect(text).not.toMatch(/Invalid|NaN/)
  })
})

describe('Telegram-карточка mock_exam_started — в момент начала', () => {
  it('до конца окна, до конца догрузки фото; кнопка «Открыть пробник» на страницу пробника', () => {
    const { text, replyMarkup } = buildMockExamStartTelegramMessage(payload, 'https://alminion.ru')
    expect(text).toBe(
      '📝 <b>Пробник начался</b>\n\n' +
      '«Пробник №3» · до 14:00\n' +
      'Фото второй части — до 14:15',
    )
    expect(replyMarkup).toEqual({
      inline_keyboard: [[{ text: 'Открыть пробник', url: 'https://alminion.ru/my-course/g-1/mock/e-1' }]],
    })
  })

  it('APP_URL не годится (localhost) — карточка уходит без кнопки, текст тот же', () => {
    const { text, replyMarkup } = buildMockExamStartTelegramMessage(payload, 'http://localhost:5173')
    expect(replyMarkup).toBeNull()
    expect(text).toContain('Пробник начался')
  })
})

describe('formatClockMsk', () => {
  it('по Москве, а не по часам сервера функции', () => {
    expect(formatClockMsk('2026-10-18T21:30:00Z')).toBe('00:30')
    expect(formatClockMsk('')).toBe('')
    expect(formatClockMsk(null)).toBe('')
  })
})

describe('галочки: оба события — «Домашние задания»', () => {
  it('homework выключен — не шлём; «Проверка ДЗ» на них не влияет; общий выключатель гасит', () => {
    for (const ev of ['mock_exam_soon', 'mock_exam_started']) {
      expect(isTelegramPreferenceEnabled(ev, { telegram: true, homework: true, checked: false })).toBe(true)
      expect(isTelegramPreferenceEnabled(ev, { telegram: true, homework: false, checked: true })).toBe(false)
      expect(isTelegramPreferenceEnabled(ev, { telegram: false, homework: true })).toBe(false)
      expect(isTelegramPreferenceEnabled(ev, { telegram: true, homework: null })).toBe(true)
    }
  })
})
