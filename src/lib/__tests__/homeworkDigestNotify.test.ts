/**
 * §243. Сводка «новые домашние задания» — одна Telegram-карточка на ученика.
 *
 * Карточку собирает `process-notification-queue` через
 * `_shared/homework-digest.ts` — здесь проверяются настоящие функции этого
 * файла. Payload — тот, что кладёт `topic_homework_digest_flush` (миграция
 * PENDING_243 → supabase/tests/avtovydacha_243/probes.out, шаг 13):
 * `{ count, items: [{ course_title, title, due_date, link }], courses: [{ course_title, link, count }], link }`.
 */
import { describe, expect, it } from 'vitest'
import { buildHomeworkDigestTelegramMessage, newHomeworkWord } from '../../../supabase/functions/_shared/homework-digest'
import { isTelegramPreferenceEnabled } from '../../../supabase/functions/_shared/variant-telegram'

const APP = 'https://alminion.ru'
// Год — нынешний: formatDay пишет год только у чужого года.
const Y = new Date().getUTCFullYear()
const PHYS = 'Физика ЕГЭ 11А класс'
const MATH = 'Математика ЕГЭ — 11А'
const item = (course: string, title: string, due: string | null, topic: string, group = 'g-1') => ({
  course_title: course, title, due_date: due, link: `/my-course/${group}/topic/${topic}`,
})

describe('Telegram-карточка new_homework_digest', () => {
  it('одно ДЗ — та же карточка, что new_homework: курс · тема, срок, «Открыть задание»', () => {
    const one = item(PHYS, 'Законы Ньютона', `${Y}-10-03`, 't-1')
    const { text, replyMarkup } = buildHomeworkDigestTelegramMessage(
      { count: 1, items: [one], courses: [{ course_title: PHYS, link: '/my-course/g-1', count: 1 }], link: one.link }, APP)
    expect(text).toBe(
      '📚 <b>Новое домашнее задание</b>\n\n' +
      'Физика ЕГЭ 11А класс · Законы Ньютона\n' +
      'Сдать до 3 октября',
    )
    expect(replyMarkup).toEqual({ inline_keyboard: [[{ text: 'Открыть задание', url: 'https://alminion.ru/my-course/g-1/topic/t-1' }]] })
  })

  it('одно ДЗ без срока — «Без дедлайна»', () => {
    const { text } = buildHomeworkDigestTelegramMessage({ items: [item(PHYS, 'Импульс тела', null, 't-2')] }, APP)
    expect(text).toBe('📚 <b>Новое домашнее задание</b>\n\nФизика ЕГЭ 11А класс · Импульс тела\nБез дедлайна')
  })

  it('3 ДЗ в двух курсах — список по курсам со сроками, кнопка «Мои задания»', () => {
    const { text, replyMarkup } = buildHomeworkDigestTelegramMessage({
      count: 3,
      items: [
        item(PHYS, 'Законы Ньютона', `${Y}-10-03`, 't-1'),
        item(PHYS, 'Импульс тела', null, 't-2'),
        item(MATH, 'Производная сложной функции', `${Y}-10-02`, 't-7', 'g-2'),
      ],
      courses: [
        { course_title: PHYS, link: '/my-course/g-1', count: 2 },
        { course_title: MATH, link: '/my-course/g-2', count: 1 },
      ],
      link: '/my-homework',
    }, APP)
    expect(text).toBe(
      '📚 <b>Новые домашние задания: 3</b>\n\n' +
      '<b>Физика ЕГЭ 11А класс</b>\n' +
      '• Законы Ньютона — до 3 октября\n' +
      '• Импульс тела — без дедлайна\n\n' +
      '<b>Математика ЕГЭ — 11А</b>\n' +
      '• Производная сложной функции — до 2 октября',
    )
    expect(replyMarkup).toEqual({ inline_keyboard: [[{ text: 'Мои задания', url: 'https://alminion.ru/my-homework' }]] })
  })

  it('несколько ДЗ одного курса — кнопка «Открыть курс» ведёт на курс', () => {
    const { replyMarkup } = buildHomeworkDigestTelegramMessage({
      items: [item(PHYS, 'Законы Ньютона', null, 't-1'), item(PHYS, 'Импульс тела', null, 't-2')],
      courses: [{ course_title: PHYS, link: '/my-course/g-1', count: 2 }],
    }, APP)
    expect(replyMarkup).toEqual({ inline_keyboard: [[{ text: 'Открыть курс', url: 'https://alminion.ru/my-course/g-1' }]] })
  })

  it('14 ДЗ — одна строка с числом, курс, «Список — в курсе», кнопка на курс', () => {
    const titles = ['Кинематика', 'Свободное падение', 'Движение по окружности', 'Силы в природе', 'Сила трения', 'Закон Гука',
      'Всемирное тяготение', 'Статика', 'Давление', 'Закон Архимеда', 'Гидростатика', 'Колебания', 'Волны', 'Звук']
    const { text, replyMarkup } = buildHomeworkDigestTelegramMessage({
      count: 14,
      items: titles.map((t, i) => item(PHYS, t, null, `t-${i}`)),
      courses: [{ course_title: PHYS, link: '/my-course/g-1', count: 14 }],
      link: '/my-course/g-1',
    }, APP)
    expect(text).toBe('📚 <b>Открыто 14 новых домашних заданий</b>\n\nФизика ЕГЭ 11А класс\nСписок — в курсе')
    expect(text).not.toContain('Кинематика')
    expect(replyMarkup).toEqual({ inline_keyboard: [[{ text: 'Открыть курс', url: 'https://alminion.ru/my-course/g-1' }]] })
  })

  it('10+ в двух курсах — курсы через запятую, «Мои задания»', () => {
    const items = [
      ...Array.from({ length: 11 }, (_, i) => item(PHYS, `Тема ${i}`, null, `p-${i}`)),
      ...Array.from({ length: 10 }, (_, i) => item(MATH, `Тема ${i}`, null, `m-${i}`, 'g-2')),
    ]
    const { text, replyMarkup } = buildHomeworkDigestTelegramMessage({ items }, APP)
    expect(text).toBe('📚 <b>Открыто 21 новое домашнее задание</b>\n\nФизика ЕГЭ 11А класс, Математика ЕГЭ — 11А\nСписок — в курсе')
    expect(replyMarkup?.inline_keyboard[0][0].text).toBe('Мои задания')
  })

  it('названия экранируются; без APP_URL — без кнопки', () => {
    const { text, replyMarkup } = buildHomeworkDigestTelegramMessage({
      items: [item('A & B', 'x < y', null, 't-1'), item('A & B', 'Тема <2>', null, 't-2')],
    }, '')
    expect(text).toContain('<b>A &amp; B</b>')
    expect(text).toContain('• x &lt; y — без дедлайна')
    expect(text).toContain('• Тема &lt;2&gt; — без дедлайна')
    expect(replyMarkup).toBeNull()
  })

  it('склонение числа в заголовке 10+', () => {
    expect(newHomeworkWord(10)).toBe('новых домашних заданий')
    expect(newHomeworkWord(11)).toBe('новых домашних заданий')
    expect(newHomeworkWord(21)).toBe('новое домашнее задание')
    expect(newHomeworkWord(22)).toBe('новых домашних задания')
    expect(newHomeworkWord(112)).toBe('новых домашних заданий')
  })

  it('галочка «Домашние задания» выключена — сводку не шлём; общий выключатель Telegram — тоже', () => {
    expect(isTelegramPreferenceEnabled('new_homework_digest', { telegram: true, homework: false })).toBe(false)
    expect(isTelegramPreferenceEnabled('new_homework_digest', { telegram: true, homework: true })).toBe(true)
    expect(isTelegramPreferenceEnabled('new_homework_digest', { telegram: true })).toBe(true)
    expect(isTelegramPreferenceEnabled('new_homework_digest', { telegram: false, homework: true })).toBe(false)
    // от галочки просрочки не зависит
    expect(isTelegramPreferenceEnabled('new_homework_digest', { telegram: true, homework: true, overdue: false })).toBe(true)
  })
})
