/**
 * §264. Напоминания ученикам в Telegram — правила чистого модуля `supabase/functions/_shared/student-reminders.ts`
 * (его же зовут edge-функция student-reminders и очередь process-notification-queue). Здесь — поведение: границы
 * времени по Москве, тишина, лимит 2 в день с приоритетом и бронью, дедупликация, выключенные виды, тексты.
 * Время — абсолютные моменты: Москва = UTC+3 (без перехода на летнее).
 */
import { describe, expect, it } from 'vitest'
import {
  DAILY_LIMIT, REMINDER_KINDS, buildStudentReminderTelegramMessage, dedupKey, fireWindow, isDue, isEligible,
  isQuietMsk, isReminderStale, kindsToFetch, mskDay, normalizeCandidates, normalizeLog, outOfQuiet, planReminders,
  studentReminderAllowedByPrefs, studentReminderText, type ReminderCandidate, type ReminderLogRow,
} from '../../../supabase/functions/_shared/student-reminders'
import { isTelegramPreferenceEnabled } from '../../../supabase/functions/_shared/variant-telegram'
import { REMINDER_KIND_OPTIONS } from '../studentReminders'

/** «2026-10-05 19:00» по Москве → Date. */
const at = (s: string) => new Date(s.replace(' ', 'T') + ':00+03:00')
const D = '2026-10-05'

function cand(over: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    kind: 'hw_due_tomorrow', eventKey: 'hw-1:2026-10-06', profileId: 'p-1', studentId: 's-1', courseId: 'c-1',
    groupId: 'g-1', entityId: 'hw-1', title: 'Динамика. Законы Ньютона', workKind: null, opensAt: null, closesAt: null,
    dueDate: '2026-10-06', link: '/my-course/g-1/topic/t-1', done: false, hasDraft: false, hasPhoto: false,
    opened: false, streak: 0, solvedToday: false, telegram: true, courseOn: true, studentOn: true, ...over,
  }
}
const hwDue = (over: Partial<ReminderCandidate> = {}) => cand(over)
const hwOverdue = (over: Partial<ReminderCandidate> = {}) =>
  cand({ kind: 'hw_overdue', eventKey: 'hw-2:2026-10-04', entityId: 'hw-2', title: 'Силы в природе', dueDate: '2026-10-04', ...over })
const checkSoon = (opens: string, over: Partial<ReminderCandidate> = {}) =>
  cand({ kind: 'check_soon', eventKey: `w-1:${opens}`, entityId: 'w-1', title: 'Движение по окружности', workKind: 'check',
    opensAt: at(opens).toISOString(), closesAt: new Date(at(opens).getTime() + 45 * 60_000).toISOString(), dueDate: null, ...over })
const noPhoto = (closes: string, over: Partial<ReminderCandidate> = {}) =>
  cand({ kind: 'no_photo', eventKey: `w-2:${closes}`, entityId: 'w-2', title: 'Кинематика', workKind: 'control',
    opensAt: new Date(at(closes).getTime() - 45 * 60_000).toISOString(), closesAt: at(closes).toISOString(), dueDate: null,
    hasDraft: true, ...over })
const streak = (n: number, over: Partial<ReminderCandidate> = {}) =>
  cand({ kind: 'streak', eventKey: D, entityId: null, courseId: null, title: '', dueDate: null, link: '/student', streak: n, ...over })
const mock = (over: Partial<ReminderCandidate> = {}) =>
  cand({ kind: 'mock_tomorrow', eventKey: 'm-1', entityId: 'm-1', title: 'Пробник №2', dueDate: null,
    opensAt: at('2026-10-06 10:00').toISOString(), closesAt: at('2026-10-06 13:55').toISOString(), link: '/my-course/g-1?mock=m-1', ...over })
const log = (c: ReminderCandidate, when: string, status = 'sent'): ReminderLogRow =>
  ({ profileId: c.profileId, key: dedupKey(c), status, scheduledFor: at(when).toISOString() })

describe('время по Москве и тишина 22:00–08:00', () => {
  it('день и границы тишины', () => {
    expect(mskDay(at('2026-10-05 23:30'))).toBe('2026-10-05')
    expect(mskDay(at('2026-10-06 02:00'))).toBe('2026-10-06')
    expect(isQuietMsk(at(`${D} 21:59`))).toBe(false)
    expect(isQuietMsk(at(`${D} 22:00`))).toBe(true)
    expect(isQuietMsk(at(`${D} 07:59`))).toBe(true)
    expect(isQuietMsk(at(`${D} 08:00`))).toBe(false)
  })
  it('момент в тишине переносится на ближайшие 08:00', () => {
    expect(outOfQuiet(at(`${D} 07:45`)).toISOString()).toBe(at(`${D} 08:00`).toISOString())
    expect(outOfQuiet(at(`${D} 23:10`)).toISOString()).toBe(at('2026-10-06 08:00').toISOString())
    expect(outOfQuiet(at(`${D} 12:00`)).toISOString()).toBe(at(`${D} 12:00`).toISOString())
  })
  it('в тишине база не спрашивается; серия — только когда её окно открыто', () => {
    expect(kindsToFetch(at(`${D} 22:30`))).toEqual([])
    expect(kindsToFetch(at(`${D} 07:50`))).toEqual([])
    expect(kindsToFetch(at(`${D} 07:55`))).not.toContain('streak')
    expect(kindsToFetch(at(`${D} 07:55`))).toContain('check_soon')
    expect(kindsToFetch(at(`${D} 18:24`))).not.toContain('streak')
    expect(kindsToFetch(at(`${D} 18:25`))).toContain('streak')
    expect(kindsToFetch(at(`${D} 21:58`))).toContain('streak')
  })
})

describe('когда: моменты видов (крон раз в 5 минут, запас вперёд 5 минут)', () => {
  it('«Срок ДЗ завтра» — накануне в 19:00, до 22:00; не тот срок — нет', () => {
    expect(fireWindow(hwDue(), at(`${D} 12:00`))?.at.toISOString()).toBe(at(`${D} 19:00`).toISOString())
    expect(isDue(hwDue(), at(`${D} 18:54`))).toBe(false)
    expect(isDue(hwDue(), at(`${D} 18:55`))).toBe(true)
    expect(isDue(hwDue(), at(`${D} 21:59`))).toBe(true)
    expect(isDue(hwDue(), at(`${D} 22:00`))).toBe(false)
    expect(fireWindow(hwDue({ dueDate: '2026-10-07' }), at(`${D} 19:00`))).toBeNull()
    // после полуночи «завтра» — уже сегодня: напоминания нет
    expect(fireWindow(hwDue(), at('2026-10-06 09:00'))).toBeNull()
  })
  it('«Срок ДЗ прошёл» — на следующий день после срока в 17:00', () => {
    expect(isDue(hwOverdue(), at(`${D} 16:54`))).toBe(false)
    expect(isDue(hwOverdue(), at(`${D} 16:55`))).toBe(true)
    expect(fireWindow(hwOverdue({ dueDate: D }), at(`${D} 17:00`))).toBeNull()
  })
  it('«Скоро проверочная» — за час до начала; в тишине — на 08:00, если работа ещё впереди', () => {
    expect(fireWindow(checkSoon(`${D} 13:00`), at(`${D} 11:00`))?.at.toISOString()).toBe(at(`${D} 12:00`).toISOString())
    expect(fireWindow(checkSoon(`${D} 08:45`), at(`${D} 07:00`))?.at.toISOString()).toBe(at(`${D} 08:00`).toISOString())
    expect(fireWindow(checkSoon(`${D} 08:00`), at(`${D} 07:00`))).toBeNull()
    expect(fireWindow(checkSoon('2026-10-06 00:30'), at(`${D} 21:00`))).toBeNull()
    expect(isDue(checkSoon(`${D} 13:00`), at(`${D} 13:00`))).toBe(false)
  })
  it('«Нет фото» — за 10 минут до конца окна', () => {
    expect(fireWindow(noPhoto(`${D} 09:30`), at(`${D} 09:00`))?.at.toISOString()).toBe(at(`${D} 09:20`).toISOString())
    expect(fireWindow(noPhoto(`${D} 08:05`), at(`${D} 07:30`))?.at.toISOString()).toBe(at(`${D} 08:00`).toISOString())
    expect(isDue(noPhoto(`${D} 09:30`), at(`${D} 09:31`))).toBe(false)
  })
  it('«Серия» — в 18:30; «Пробник завтра» — накануне в 19:00', () => {
    expect(fireWindow(streak(4), at(`${D} 10:00`))?.at.toISOString()).toBe(at(`${D} 18:30`).toISOString())
    expect(fireWindow(mock(), at(`${D} 10:00`))?.at.toISOString()).toBe(at(`${D} 19:00`).toISOString())
    expect(fireWindow(mock(), at('2026-10-06 09:00'))).toBeNull()
  })
})

describe('кто: без Telegram, выключенные виды, сдано, фото, серия', () => {
  it('нет Telegram, выключено в курсе или у ученика — не подходит', () => {
    expect(isEligible(hwDue())).toBe(true)
    expect(isEligible(hwDue({ telegram: false }))).toBe(false)
    expect(isEligible(hwDue({ courseOn: false }))).toBe(false)
    expect(isEligible(hwDue({ studentOn: false }))).toBe(false)
    expect(isEligible(hwDue({ done: true }))).toBe(false)
  })
  it('«нет фото» — черновик без фото или «открыл условие» (§263) без фото; сдал — нет', () => {
    expect(isEligible(noPhoto(`${D} 09:30`))).toBe(true)
    expect(isEligible(noPhoto(`${D} 09:30`, { hasPhoto: true }))).toBe(false)
    expect(isEligible(noPhoto(`${D} 09:30`, { hasDraft: false }))).toBe(false)
    expect(isEligible(noPhoto(`${D} 09:30`, { hasDraft: false, opened: true }))).toBe(true)
    expect(isEligible(noPhoto(`${D} 09:30`, { done: true }))).toBe(false)
  })
  it('серия — от 3 дней и сегодня ещё не решал', () => {
    expect(isEligible(streak(2))).toBe(false)
    expect(isEligible(streak(3))).toBe(true)
    expect(isEligible(streak(6, { solvedToday: true }))).toBe(false)
  })
  it('по умолчанию в курсе включено всё, кроме «Пробник завтра»; список видов — общий с клиентом', () => {
    expect(REMINDER_KINDS.filter(k => !k.defaultOn).map(k => k.kind)).toEqual(['mock_tomorrow'])
    expect(REMINDER_KIND_OPTIONS.map(k => k.kind)).toEqual(REMINDER_KINDS.map(k => k.kind))
  })
})

describe('сколько: лимит 2 в день, приоритет, бронь, дедупликация', () => {
  it('одновременно три — уходят два старших: проверочная > нет фото > срок ДЗ > серия', () => {
    const now = at(`${D} 19:00`)
    const list = [hwDue(), mock(), streak(5), hwOverdue()]
    const plan = planReminders(list, [], now)
    expect(plan.queue.map(q => q.payload.kind)).toEqual(['mock_tomorrow', 'hw_due_tomorrow'])
    expect(plan.skipped.filter(s => s.reason === 'daily_limit')).toHaveLength(2)
    expect(plan.queue).toHaveLength(DAILY_LIMIT)
  })
  it('уже ушедшие сегодня считаются; погашенные и вчерашние — нет', () => {
    const now = at(`${D} 19:00`)
    const other = hwOverdue({ eventKey: 'x' })
    expect(planReminders([hwDue()], [log(other, `${D} 17:00`), log(streak(3), `${D} 18:30`)], now).queue).toHaveLength(0)
    expect(planReminders([hwDue()], [log(other, `${D} 17:00`), log(streak(3), `${D} 18:30`, 'cancelled')], now).queue).toHaveLength(1)
    expect(planReminders([hwDue()], [log(other, '2026-10-04 17:00'), log(streak(3), '2026-10-04 18:30')], now).queue).toHaveLength(1)
  })
  it('бронь: младшее не занимает последнее место, если позже сегодня ждёт старшее', () => {
    // 17:00: «срок прошёл» (5) при двух старших в 19:00 (пробник 3, срок завтра 4) — бронь
    const at17 = planReminders([hwOverdue(), hwDue(), mock()], [], at(`${D} 17:00`))
    expect(at17.queue).toHaveLength(0)
    expect(at17.skipped.find(s => s.key === dedupKey(hwOverdue()))?.reason).toBe('reserved')
    // одно старшее впереди — место есть
    expect(planReminders([hwOverdue(), hwDue()], [], at(`${D} 17:00`)).queue.map(q => q.payload.kind)).toEqual(['hw_overdue'])
    // младшее впереди (серия) брони не даёт
    expect(planReminders([hwOverdue(), streak(4)], [], at(`${D} 17:00`)).queue).toHaveLength(1)
  })
  it('дедупликация: событие из журнала второй раз не ставится, ключ «вид × событие × ученик»', () => {
    const c = hwDue()
    expect(dedupKey(c)).toBe('student_reminder:hw_due_tomorrow:hw-1:2026-10-06:p-1')
    const plan = planReminders([c, { ...c }], [log(c, `${D} 19:00`)], at(`${D} 19:05`))
    expect(plan.queue).toHaveLength(0)
    expect(plan.skipped.map(s => s.reason)).toEqual(['duplicate'])
    // у другого ученика то же событие — своё
    expect(planReminders([c, hwDue({ profileId: 'p-2' })], [log(c, `${D} 19:00`)], at(`${D} 19:05`)).queue.map(q => q.profile_id)).toEqual(['p-2'])
  })
  it('строка очереди: event_type, ключ, scheduled_for = момент (запас вперёд), payload для текста', () => {
    const [q] = planReminders([checkSoon(`${D} 13:00`)], [], at(`${D} 11:57`)).queue
    expect(q).toMatchObject({ event_type: 'student_reminder', channel: 'telegram', status: 'pending', entity_type: 'topic_homework', entity_id: 'w-1' })
    expect(q.scheduled_for).toBe(at(`${D} 12:00`).toISOString())
    expect(q.payload).toMatchObject({ kind: 'check_soon', title: 'Движение по окружности', work_kind: 'check' })
    const [late] = planReminders([checkSoon(`${D} 13:00`)], [], at(`${D} 12:20`)).queue
    expect(late.scheduled_for).toBe(at(`${D} 12:20`).toISOString())
  })
  it('в тишине ничего не ставится', () => {
    expect(planReminders([hwDue(), streak(5), checkSoon('2026-10-06 08:45')], [], at(`${D} 22:30`)).queue).toHaveLength(0)
  })
})

describe('тексты (макет В: без эмодзи, кнопка-ссылка)', () => {
  const APP = 'https://alminion.ru'
  const msg = (c: ReminderCandidate, now: Date) => {
    const [q] = planReminders([c], [], now).queue
    return buildStudentReminderTelegramMessage(q.payload, APP, new Date(q.scheduled_for))
  }
  it('срок ДЗ завтра / прошёл', () => {
    const m = msg(hwDue(), at(`${D} 19:00`))
    expect(m.text).toBe('Завтра срок ДЗ «Динамика. Законы Ньютона». Ещё не сдано.')
    expect(m.replyMarkup).toEqual({ inline_keyboard: [[{ text: 'Открыть ДЗ', url: 'https://alminion.ru/my-course/g-1/topic/t-1' }]] })
    expect(msg(hwOverdue(), at(`${D} 17:00`)).text).toBe('Вчера был срок ДЗ «Силы в природе», а работа не сдана. Сдать можно и сейчас.')
  })
  it('скоро проверочная: «через час» и время окна; перенос из тишины — честные минуты; контрольная', () => {
    expect(msg(checkSoon(`${D} 08:45`), at(`${D} 07:55`)).text)
      .toBe('Через 45 минут проверочная «Движение по окружности», 08:45–09:30. Возьми листы и заряженный телефон.')
    const m = msg(checkSoon(`${D} 13:00`, { workKind: 'control' }), at(`${D} 12:00`))
    expect(m.text).toBe('Через час контрольная «Движение по окружности», 13:00–13:45. Возьми листы и заряженный телефон.')
    expect(m.replyMarkup?.inline_keyboard[0][0].text).toBe('Открыть работу')
  })
  it('нет фото, серия, пробник', () => {
    const p = msg(noPhoto(`${D} 09:30`, { workKind: 'check' }), at(`${D} 09:20`))
    expect(p.text).toBe('До конца проверочной 10 минут, а фото ещё нет. Без фото работа не уйдёт.')
    expect(p.replyMarkup?.inline_keyboard[0][0].text).toBe('Загрузить фото')
    expect(msg(streak(6), at(`${D} 18:30`)).text).toBe('Серия 6 дней! Реши сегодня одну задачу — и будет 7. Задача дня уже ждёт.')
    expect(studentReminderText({ kind: 'streak', streak: 21 })).toBe('Серия 21 день! Реши сегодня одну задачу — и будет 22. Задача дня уже ждёт.')
    expect(studentReminderText({ kind: 'streak', streak: 3 })).toContain('Серия 3 дня!')
    const mk = msg(mock(), at(`${D} 19:00`))
    expect(mk.text).toBe('Завтра пробник «Пробник №2», 10:00–13:55. Нужны черновик, ручка и телефон для фото второй части.')
    expect(mk.replyMarkup?.inline_keyboard[0][0]).toEqual({ text: 'Открыть пробник', url: 'https://alminion.ru/my-course/g-1?mock=m-1' })
  })
  it('названия экранируются (HTML-режим Telegram), эмодзи нет ни в одном тексте', () => {
    expect(studentReminderText({ kind: 'hw_due_tomorrow', title: 'x < y & z' })).toBe('Завтра срок ДЗ «x &lt; y &amp; z». Ещё не сдано.')
    const now = at(`${D} 12:00`)
    const texts = [
      { kind: 'hw_due_tomorrow', title: 'А' }, { kind: 'hw_overdue', title: 'А' },
      { kind: 'check_soon', title: 'А', opens_at: at(`${D} 13:00`).toISOString(), closes_at: at(`${D} 13:45`).toISOString() },
      { kind: 'no_photo', title: 'А', closes_at: at(`${D} 12:10`).toISOString() }, { kind: 'streak', streak: 4 },
      { kind: 'mock_tomorrow', title: 'А', opens_at: at('2026-10-06 10:00').toISOString() },
    ].map(p => studentReminderText(p, now))
    for (const t of texts) expect(t).not.toMatch(/\p{Extended_Pictographic}/u)
  })
  it('без адреса сайта кнопки нет (сообщение уходит без неё)', () => {
    expect(buildStudentReminderTelegramMessage({ kind: 'streak', streak: 4, link: '/student' }, '').replyMarkup).toBeNull()
  })
})

describe('очередь: выключатели ученика, устаревшее, общий выключатель Telegram', () => {
  it('ученик выключил вид — не шлём; нет значения — шлём', () => {
    expect(studentReminderAllowedByPrefs('streak', { remind_streak: false })).toBe(false)
    expect(studentReminderAllowedByPrefs('streak', { remind_streak: true })).toBe(true)
    expect(studentReminderAllowedByPrefs('streak', {})).toBe(true)
    expect(studentReminderAllowedByPrefs('чужое', {})).toBe(false)
  })
  it('проверочная уже началась / окно закрылось — напоминание устарело', () => {
    const opens = at(`${D} 13:00`).toISOString()
    expect(isReminderStale({ kind: 'check_soon', opens_at: opens }, at(`${D} 12:58`))).toBe(false)
    expect(isReminderStale({ kind: 'check_soon', opens_at: opens }, at(`${D} 13:00`))).toBe(true)
    expect(isReminderStale({ kind: 'no_photo', closes_at: opens }, at(`${D} 13:01`))).toBe(true)
    expect(isReminderStale({ kind: 'hw_due_tomorrow' }, at(`${D} 23:00`))).toBe(false)
  })
  it('общий выключатель Telegram гасит и напоминания', () => {
    expect(isTelegramPreferenceEnabled('student_reminder', { telegram: true })).toBe(true)
    expect(isTelegramPreferenceEnabled('student_reminder', { telegram: false })).toBe(false)
    expect(isTelegramPreferenceEnabled('student_reminder', null)).toBe(false)
  })
})

describe('разбор ответа базы', () => {
  it('кандидаты: мусор пропускается, student_on по умолчанию — включено', () => {
    const got = normalizeCandidates([
      { kind: 'streak', event_key: D, profile_id: 'p-1', streak: '4', telegram: true, course_on: true },
      { kind: 'нечто', event_key: 'x', profile_id: 'p-1' },
      { kind: 'streak', profile_id: 'p-1' },
      null,
    ])
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ kind: 'streak', streak: 4, studentOn: true, telegram: true, courseOn: true, done: false })
    expect(normalizeCandidates('x')).toEqual([])
  })
  it('журнал', () => {
    expect(normalizeLog([{ profile_id: 'p', key: 'k', status: 'sent', scheduled_for: '2026-10-05T16:00:00Z' }, { key: 'k' }]))
      .toEqual([{ profileId: 'p', key: 'k', status: 'sent', scheduledFor: '2026-10-05T16:00:00Z' }])
  })
})
