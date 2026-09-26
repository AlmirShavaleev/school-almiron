/**
 * §233. Напоминание «срок ДЗ прошёл» — кнопка «Напомнить всем» на главной.
 *
 * Карточку собирает `process-notification-queue` через
 * `_shared/variant-telegram.ts` — здесь проверяются настоящие функции из этого
 * файла. Payload — тот, что кладёт `remind_overdue_homework` (PENDING_233.sql):
 * `{ items: [{ title, course_title, due_date, link }], link }`.
 */
import { describe, expect, it } from 'vitest'
import {
  buildHomeworkReminderTelegramMessage,
  isTelegramPreferenceEnabled,
} from '../../../supabase/functions/_shared/variant-telegram'

const APP = 'https://alminion.ru'
// Год — нынешний: formatDay пишет год только у чужого года.
const Y = new Date().getUTCFullYear()
const item = (title: string, due: string, topic: string) => ({
  title, course_title: 'Математика 11А', due_date: due, link: `/my-course/g-1/topic/${topic}`,
})

describe('Telegram-карточка topic_homework_reminder', () => {
  it('одно ДЗ: заголовок, курс · тема, «Срок был …», кнопка на тему', () => {
    const { text, replyMarkup } = buildHomeworkReminderTelegramMessage(
      { items: [item('Отбор корней', `${Y}-09-24`, 't-13')], link: '/my-course/g-1/topic/t-13' }, APP)
    expect(text).toBe(
      '⏰ <b>Срок ДЗ прошёл — работа не сдана</b>\n\n' +
      'Математика 11А · Отбор корней\n' +
      'Срок был 24 сентября',
    )
    expect(replyMarkup).toEqual({ inline_keyboard: [[{ text: 'Открыть задание', url: 'https://alminion.ru/my-course/g-1/topic/t-13' }]] })
  })

  it('два ДЗ — одно сообщение со списком, кнопка на первое (самое давнее)', () => {
    const { text, replyMarkup } = buildHomeworkReminderTelegramMessage(
      { items: [item('Отбор корней', `${Y}-09-24`, 't-13'), item('Векторы', `${Y}-09-25`, 't-2')] }, APP)
    expect(text).toBe(
      '⏰ <b>Срок прошёл — не сданы 2 ДЗ</b>\n\n' +
      '• Математика 11А · Отбор корней — срок был 24 сентября\n' +
      '• Математика 11А · Векторы — срок был 25 сентября',
    )
    expect(replyMarkup?.inline_keyboard[0][0]).toEqual({ text: 'Открыть первое ДЗ', url: 'https://alminion.ru/my-course/g-1/topic/t-13' })
  })

  it('название экранируется; без даты и курса — без висящих разделителей; без APP_URL — без кнопки', () => {
    const { text, replyMarkup } = buildHomeworkReminderTelegramMessage(
      { items: [{ title: 'x < y & z', link: '/my-course/g/topic/t' }] }, '')
    expect(text).toBe('⏰ <b>Срок ДЗ прошёл — работа не сдана</b>\n\nx &lt; y &amp; z')
    expect(replyMarkup).toBeNull()
  })

  it('галочка «Просроченное ДЗ» выключена — не шлём; общий выключатель Telegram — тоже', () => {
    expect(isTelegramPreferenceEnabled('topic_homework_reminder', { telegram: true, overdue: false })).toBe(false)
    expect(isTelegramPreferenceEnabled('topic_homework_reminder', { telegram: true, overdue: true })).toBe(true)
    expect(isTelegramPreferenceEnabled('topic_homework_reminder', { telegram: true })).toBe(true)
    expect(isTelegramPreferenceEnabled('topic_homework_reminder', { telegram: false, overdue: true })).toBe(false)
    // «Новое ДЗ» от галочки просрочки не зависит
    expect(isTelegramPreferenceEnabled('new_homework', { telegram: true, overdue: false, homework: true })).toBe(true)
  })
})
