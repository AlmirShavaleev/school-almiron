/**
 * §219. Уведомление о результате пробника: правило «одному итогу — одно
 * уведомление» на стороне экрана и текст Telegram-карточки.
 *
 * Карточку собирает `process-notification-queue` через
 * `_shared/variant-telegram.ts` — здесь проверяется настоящая функция из
 * этого файла, а не копия.
 */
import { describe, expect, it } from 'vitest'
import {
  canNotify,
  formatSentAt,
  notifyState,
  pendingRecipients,
  type MockExamResultNotifyRow,
} from '@/lib/mockExamNotify'
import {
  buildMockExamResultTelegramMessage,
  isTelegramPreferenceEnabled,
} from '../../../supabase/functions/_shared/variant-telegram'

const row = (over: Partial<MockExamResultNotifyRow> = {}): MockExamResultNotifyRow => ({
  student_id: 's1', score: 18, part1_score: 10, part2_score: 8,
  notified_at: null, notified_score: null, notified_part1_score: null, notified_part2_score: null,
  ...over,
})

describe('notifyState — что показывает строка', () => {
  it('итога нет — отправлять нечего', () => {
    expect(notifyState(undefined)).toEqual({ kind: 'none' })
    expect(canNotify(notifyState(undefined))).toBe(false)
  })
  it('итог есть, не отправлялся — можно', () => {
    expect(notifyState(row())).toEqual({ kind: 'ready' })
    expect(canNotify(notifyState(row()))).toBe(true)
  })
  it('отправлен этот же итог — второй раз нельзя', () => {
    const r = row({ notified_at: '2026-09-25T17:40:00Z', notified_score: 18, notified_part1_score: 10, notified_part2_score: 8 })
    expect(notifyState(r)).toEqual({ kind: 'sent', at: '2026-09-25T17:40:00Z' })
    expect(canNotify(notifyState(r))).toBe(false)
  })
  it('итог изменился после отправки — снова можно', () => {
    const r = row({ score: 20, part2_score: 10, notified_at: '2026-09-25T17:40:00Z', notified_score: 18, notified_part1_score: 10, notified_part2_score: 8 })
    expect(notifyState(r).kind).toBe('changed')
    expect(canNotify(notifyState(r))).toBe(true)
  })
  it('итог тот же, а части переложились — это другой итог: в тексте стоят части', () => {
    const r = row({ part1_score: 9, part2_score: 9, notified_at: '2026-09-25T17:40:00Z', notified_score: 18, notified_part1_score: 10, notified_part2_score: 8 })
    expect(notifyState(r).kind).toBe('changed')
  })
})

describe('pendingRecipients — кому уйдёт «Уведомить всех»', () => {
  it('только тем, у кого итог есть и этот итог не отправлен; без профиля — никому', () => {
    const sent = { notified_at: '2026-09-25T17:40:00Z', notified_score: 18, notified_part1_score: 10, notified_part2_score: 8 }
    const roster = [
      { id: 'a', profileId: 'pa' }, // не отправлялся
      { id: 'b', profileId: 'pb' }, // отправлен тот же итог
      { id: 'c', profileId: 'pc' }, // изменился после отправки
      { id: 'd', profileId: 'pd' }, // итога нет
      { id: 'e', profileId: null }, // нет учётной записи
    ]
    const results = {
      a: row({ student_id: 'a' }),
      b: row({ student_id: 'b', ...sent }),
      c: row({ student_id: 'c', score: 25, ...sent }),
      e: row({ student_id: 'e' }),
    }
    expect(pendingRecipients(roster, results)).toEqual(['a', 'c'])
  })
})

describe('formatSentAt', () => {
  it('по Москве, коротко', () => {
    expect(formatSentAt('2026-09-25T17:40:00Z')).toBe('25.09, 20:40')
  })
})

describe('Telegram-карточка mock_exam_result', () => {
  // Текущий год: formatDay пишет год только у «не нашего» года, и тест с
  // зашитым 2026 покраснел бы в январе.
  const base = {
    title: 'Пробник №3', exam_date: `${new Date().getUTCFullYear()}-10-18`,
    score: 18, max_score: 32, primary_score: 18, primary_max: 32,
    part1_score: 10, part1_max: 12, part2_score: 8, part2_max: 20,
  }

  it('итог в заголовке, название и день, части; баллов по заданиям нет', () => {
    const { text, replyMarkup } = buildMockExamResultTelegramMessage(base)
    expect(text).toBe(
      '📊 <b>Результат пробника — 18 из 32</b>\n\n' +
      '«Пробник №3» · 18 октября\n' +
      '1 часть — 10 из 12 · 2 часть — 8 из 20',
    )
    expect(text).not.toMatch(/№\s?1\b|задани/)
    // Страницы результатов у ученика нет — кнопке вести некуда.
    expect(replyMarkup).toBeNull()
  })

  it('с таблицей перевода — строка «первичный», чтобы 10 + 8 рядом с 72 не выглядело ошибкой', () => {
    const { text } = buildMockExamResultTelegramMessage({ ...base, score: 72, max_score: 100 })
    expect(text).toContain('Результат пробника — 72 из 100')
    expect(text).toContain('Первичный балл — 18 из 32')
  })

  it('старый пробник без шаблона: частей нет — строки нет, максимумов частей нет — без «из»', () => {
    expect(buildMockExamResultTelegramMessage({ title: 'Образец', score: 61, max_score: 100 }).text)
      .toBe('📊 <b>Результат пробника — 61 из 100</b>\n\n«Образец»')
    expect(buildMockExamResultTelegramMessage({ title: 'Образец', score: 61, max_score: 100, part1_score: 40 }).text)
      .toContain('1 часть — 40')
  })

  it('название экранируется: «<» в названии не роняет карточку (400 can\'t parse entities)', () => {
    const { text } = buildMockExamResultTelegramMessage({ ...base, title: 'Пробник <b>&' })
    expect(text).toContain('«Пробник &lt;b&gt;&amp;»')
  })

  it('§223: с таблицей перевода — итог, под ним первичный, под ним части', () => {
    const { text } = buildMockExamResultTelegramMessage({ ...base, score: 72, max_score: 100, primary_score: 13, part1_score: 11, part2_score: 2 })
    expect(text).toBe(
      '📊 <b>Результат пробника — 72 из 100</b>\n\n' +
      '«Пробник №3» · 18 октября\n' +
      'Первичный балл — 13 из 32\n' +
      '1 часть — 11 из 12 · 2 часть — 2 из 20',
    )
  })

  it('§223: доля группы и разница с прошлым — отдельным абзацем, с числом написавших', () => {
    const { text } = buildMockExamResultTelegramMessage({
      ...base, score: 72, max_score: 100, primary_score: 13,
      peers: 15, better_pct: 60, is_best: false, prev_score: 64, prev_title: 'Пробник №2',
    })
    expect(text.endsWith(
      '\n\nЛучше, чем 60% группы · написали 16\n' +
      '📈 +8 к прошлому пробнику («Пробник №2» — 64)',
    )).toBe(true)
  })

  it('§223: лучший в группе; хуже прошлого — со знаком минус; поровну — словами', () => {
    const best = buildMockExamResultTelegramMessage({ ...base, peers: 5, better_pct: 100, is_best: true, prev_score: 21 }).text
    expect(best).toContain('🏆 Лучший результат в группе · написали 6')
    expect(best).toContain('📉 −3 к прошлому пробнику (было 21)')
    expect(best).not.toContain('Лучше, чем')
    expect(buildMockExamResultTelegramMessage({ ...base, prev_score: 18, prev_title: 'П' }).text)
      .toContain('Как на прошлом пробнике («П» — 18)')
  })

  it('§223: ноль процентов и маленькая группа — доли нет вовсе', () => {
    expect(buildMockExamResultTelegramMessage({ ...base, peers: 10, better_pct: 0 }).text).not.toMatch(/групп/)
    expect(buildMockExamResultTelegramMessage({ ...base, peers: 2, better_pct: 50 }).text).not.toMatch(/групп/)
    expect(buildMockExamResultTelegramMessage({ ...base, peers: 2, better_pct: null, is_best: true }).text).not.toMatch(/групп/)
    // Без статистики карточка та же, что в §219: без пустого абзаца в конце.
    expect(buildMockExamResultTelegramMessage(base).text.endsWith('8 из 20')).toBe(true)
  })

  it('§223: название прошлого пробника экранируется', () => {
    expect(buildMockExamResultTelegramMessage({ ...base, prev_score: 10, prev_title: 'A<B' }).text).toContain('«A&lt;B» — 10')
  })

  it('галочка «Проверка ДЗ» выключена — не шлём; общий выключатель — тоже', () => {
    expect(isTelegramPreferenceEnabled('mock_exam_result', { telegram: true, checked: true })).toBe(true)
    expect(isTelegramPreferenceEnabled('mock_exam_result', { telegram: true, checked: false })).toBe(false)
    expect(isTelegramPreferenceEnabled('mock_exam_result', { telegram: false, checked: true })).toBe(false)
    expect(isTelegramPreferenceEnabled('mock_exam_result', null)).toBe(false)
  })
})
