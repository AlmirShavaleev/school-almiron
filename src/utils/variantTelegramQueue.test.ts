import { describe, expect, it } from 'vitest'
import {
  buildVariantAssignedTelegramMessage,
  buildVariantDeadlineTelegramMessage,
  classifyTelegramError,
  isTelegramPreferenceEnabled,
} from '../../supabase/functions/_shared/variant-telegram'
import { buildVariantAssignmentSummaryLines } from './variantAssignmentSummary'

describe('variant telegram queue helpers', () => {
  it('builds assignment message with subject, group and deadline', () => {
    const result = buildVariantAssignedTelegramMessage({
      title: '10Б 18:00',
      subject: 'physics',
      exam_type: 'ege',
      group_name: 'ЕГЭ Физика 11Б',
      tasks_count: 10,
      due_at: '2026-07-03T15:00:00.000Z',
      link: '/student/variants/a1',
      button_text: 'Открыть вариант',
    }, 'https://app.example.com')

    // Формулировки утверждены владельцем 2026-08-03 (ТЕКСТЫ_ТГ_КАРТОЧЕК.md):
    // название в заголовке, подробности одной строкой через «·», срок отдельно.
    expect(result.text).toContain('Новый вариант — «10Б 18:00»')
    expect(result.text).toContain('Физика · ЕГЭ · ЕГЭ Физика 11Б · 10 заданий')
    expect(result.text).toContain('Сдать до 3 июля')
    expect(result.text).not.toContain('Вам назначен')
    expect(result.replyMarkup).toEqual({
      inline_keyboard: [[{ text: 'Открыть вариант', url: 'https://app.example.com/student/variants/a1' }]],
    })
  })

  it('shows no-deadline label when due_at is missing', () => {
    const result = buildVariantAssignedTelegramMessage({
      title: 'Вариант',
      due_at: null,
    }, 'https://app.example.com')

    expect(result.text).toContain('Без дедлайна')
  })

  it('shows opening date when available_from is in the future', () => {
    const result = buildVariantAssignedTelegramMessage({
      title: 'Вариант',
      available_from: '2026-07-02T09:00:00.000Z',
    }, 'https://app.example.com')

    expect(result.text).toContain('Откроется 2 июля')
  })

  it('keeps absolute links unchanged', () => {
    const result = buildVariantAssignedTelegramMessage({
      title: 'Вариант',
      link: 'https://school.example/student/variants/a1',
      button_text: 'Открыть вариант',
    }, 'https://app.example.com')

    expect(result.replyMarkup?.inline_keyboard[0][0].url).toBe('https://school.example/student/variants/a1')
  })

  it('does not create button markup when link is missing', () => {
    const result = buildVariantAssignedTelegramMessage({
      title: 'Вариант',
      button_text: 'Открыть вариант',
    }, 'https://app.example.com')

    expect(result.replyMarkup).toBeNull()
  })

  it('does not create button markup when APP_URL is missing and link is relative', () => {
    const result = buildVariantAssignedTelegramMessage({
      title: 'Вариант',
      link: '/student/variants/a1',
      button_text: 'Открыть вариант',
    }, '')

    expect(result.replyMarkup).toBeNull()
  })

  it('does not create button markup when APP_URL points to localhost', () => {
    const result = buildVariantAssignedTelegramMessage({
      title: 'Вариант',
      link: '/student/variants/a1',
      button_text: 'Открыть вариант',
    }, 'http://localhost:5173')

    expect(result.replyMarkup).toBeNull()
  })

  it('builds deadline-change message with new deadline', () => {
    const result = buildVariantDeadlineTelegramMessage({
      title: '10Б 18:00',
      due_at: '2026-07-12T16:45:00.000Z',
      link: '/student/variants/a1',
      button_text: 'Открыть вариант',
    }, 'https://app.example.com')

    expect(result.text).toContain('Новый срок сдачи — 12 июля')
    expect(result.text).toContain('Вариант «10Б 18:00»')
    expect(result.replyMarkup?.inline_keyboard[0][0].url).toBe('https://app.example.com/student/variants/a1')
  })

  it('builds deadline-cancelled message without date', () => {
    const result = buildVariantDeadlineTelegramMessage({
      title: '10Б 18:00',
      due_at: null,
    }, 'https://app.example.com')

    expect(result.text).toContain('Дедлайн снят')
    expect(result.text).toContain('можно сдать в любое время')
  })

  it('enables variant notifications when telegram and variant pref are on', () => {
    expect(isTelegramPreferenceEnabled('variant_assigned', {
      telegram: true,
      telegram_variant_assignments: true,
    })).toBe(true)
  })

  it('disables variant notifications when general telegram channel is off', () => {
    expect(isTelegramPreferenceEnabled('variant_assigned', {
      telegram: false,
      telegram_variant_assignments: true,
    })).toBe(false)
  })

  it('disables variant notifications when dedicated variant pref is off', () => {
    expect(isTelegramPreferenceEnabled('variant_assigned', {
      telegram: true,
      telegram_variant_assignments: false,
    })).toBe(false)
  })

  it('treats missing dedicated variant pref as enabled for backward compatibility', () => {
    expect(isTelegramPreferenceEnabled('variant_assigned', {
      telegram: true,
    })).toBe(true)
  })

  it('applies the same pref gate to deadline-change events', () => {
    expect(isTelegramPreferenceEnabled('variant_deadline_changed', {
      telegram: true,
      telegram_variant_assignments: false,
    })).toBe(false)
  })

  it('keeps existing homework preference routing intact', () => {
    expect(isTelegramPreferenceEnabled('new_homework', {
      telegram: true,
      homework: true,
    })).toBe(true)
    expect(isTelegramPreferenceEnabled('new_homework', {
      telegram: true,
      homework: false,
    })).toBe(false)
  })

  it('keeps existing lesson preference routing intact', () => {
    expect(isTelegramPreferenceEnabled('lesson_reminder', {
      telegram: true,
      lesson: true,
    })).toBe(true)
    expect(isTelegramPreferenceEnabled('lesson_cancelled', {
      telegram: true,
      lesson_changed: false,
    })).toBe(false)
  })

  it('classifies blocked bot errors as permanent', () => {
    const result = classifyTelegramError(403, 'Forbidden: bot was blocked by the user')
    expect(result.isBotBlocked).toBe(true)
    expect(result.isPermanent).toBe(true)
  })

  it('classifies bad request parse errors as permanent', () => {
    const result = classifyTelegramError(400, "Bad Request: can't parse entities")
    expect(result.isPermanent).toBe(true)
  })

  it('classifies transient 429 errors as retryable', () => {
    const result = classifyTelegramError(429, 'Too Many Requests: retry later')
    expect(result.isPermanent).toBe(false)
    expect(result.isBotBlocked).toBe(false)
  })

  it('classifies transient 500 errors as retryable', () => {
    const result = classifyTelegramError(500, 'Internal Server Error')
    expect(result.isPermanent).toBe(false)
  })

  it('keeps safe error messages short', () => {
    const result = classifyTelegramError(400, 'x'.repeat(500))
    expect(result.safeMessage.length).toBeLessThan(140)
  })

  it('builds summary lines with queue wording instead of delivered wording', () => {
    const lines = buildVariantAssignmentSummaryLines({
      students_created: 2,
      notifications_created: 2,
      telegram_connected: 1,
      telegram_not_connected: 1,
      telegram_queued: 1,
    })

    expect(lines).toContain('Назначено учеников: 2')
    expect(lines).toContain('В Telegram поставлено в очередь: 1')
    expect(lines.join(' ')).not.toContain('Telegram доставлен')
  })
})
