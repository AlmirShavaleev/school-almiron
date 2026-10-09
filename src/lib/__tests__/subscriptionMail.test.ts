/**
 * §282. Письма подписки через Resend — чистый модуль
 * `supabase/functions/_shared/subscription-mail.ts` (отправляет subscription-renew).
 */
import { describe, expect, it } from 'vitest'
import { RESEND_API, buildMail, formatDayMsk, planMail, type MailRow } from '../../../supabase/functions/_shared/subscription-mail.ts'

const row = (over: Partial<MailRow> = {}): MailRow => ({
  id: 1,
  kind: 'charge_failed',
  email: 'kid@example.ru',
  full_name: 'Аня Петрова',
  course_title: 'Курс с подпиской',
  source: 'purchase',
  status: 'past_due',
  access_until: '2026-10-14T21:00:00Z',
  next_charge_at: '2026-10-11T09:00:00Z',
  last_charge_error: 'insufficient_funds',
  ...over,
})

const cfg = { apiKey: 'k', from: 'Школа <noreply@school.test>', cabinetUrl: 'https://cab.test/' }

describe('formatDayMsk', () => {
  it('день по Москве', () => {
    expect(formatDayMsk('2026-10-14T21:00:00Z')).toBe('15 октября')
    expect(formatDayMsk(null)).toBeNull()
    expect(formatDayMsk('мусор')).toBeNull()
  })
})

describe('buildMail', () => {
  it('неудачное списание: причина, дата повтора, срок доступа, кнопка на кабинет', () => {
    const m = buildMail(row(), 'https://cab.test/')
    expect(m.subject).toBe('Не удалось продлить подписку')
    expect(m.text).toContain('Аня, здравствуйте!')
    expect(m.text).toContain('недостаточно средств на карте')
    expect(m.text).toContain('Повторим попытку 11 октября')
    expect(m.text).toContain('сохранится до 15 октября')
    expect(m.text).toContain('https://cab.test/my-subscription')
    expect(m.html).toContain('href="https://cab.test/my-subscription"')
  })

  it('закончилась: пробный и платный различаются', () => {
    expect(buildMail(row({ kind: 'expired', source: 'trial' }), null).subject).toBe('Пробный период закончился')
    const paid = buildMail(row({ kind: 'expired' }), null)
    expect(paid.subject).toBe('Подписка закончилась')
    expect(paid.text).toContain('Прогресс и работы сохранены')
    expect(paid.text).not.toContain('Моя подписка: ')
  })

  it('автопродление отключено', () => {
    const m = buildMail(row({ kind: 'auto_renew_off', status: 'active' }), null)
    expect(m.subject).toBe('Автопродление подписки отключено')
    expect(m.text).toContain('Курс открыт до 15 октября')
  })

  it('HTML экранируется', () => {
    const m = buildMail(row({ course_title: '<script>x</script>' }), null)
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;script&gt;')
  })
})

describe('planMail', () => {
  it('нет ключа, отправителя или адреса — пропуск с причиной', () => {
    expect(planMail(row(), { ...cfg, apiKey: '' })).toEqual({ send: false, skipped: 'no_api_key' })
    expect(planMail(row(), { ...cfg, from: undefined })).toEqual({ send: false, skipped: 'no_sender' })
    expect(planMail(row({ email: 'не почта' }), cfg)).toEqual({ send: false, skipped: 'no_email' })
  })

  it('запрос в Resend', () => {
    const p = planMail(row({ email: ' kid@example.ru ' }), cfg)
    expect(p.send).toBe(true)
    if (!p.send) return
    expect(p.request.url).toBe(RESEND_API)
    expect(p.request.body).toMatchObject({ from: cfg.from, to: ['kid@example.ru'], subject: 'Не удалось продлить подписку' })
  })
})
