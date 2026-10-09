/**
 * §282 «Подписка» — письма ученику через HTTP API Resend. Чистый модуль:
 * тексты, сборка запроса, решение «слать / пропустить». Отправку делает
 * edge-функция subscription-renew (очередь subscription_mail_outbox).
 *
 * Письма MVP: неудачное списание (с датой следующей попытки), подписка
 * закончилась, автопродление отключено. Адреса сайта в тексте нет —
 * только кнопка на кабинет (ссылка из настройки SUBSCRIPTION_APP_URL).
 */
import { cancelReasonText } from './subscription.ts'

export const RESEND_API = 'https://api.resend.com/emails'

export type MailKind = 'charge_failed' | 'expired' | 'auto_renew_off'

/** Строка из subscription_mail_claim. */
export interface MailRow {
  id: number
  kind: MailKind
  email: string | null
  full_name: string | null
  course_title: string | null
  source: string | null
  status: string | null
  access_until: string | null
  next_charge_at: string | null
  last_charge_error: string | null
}

export interface Mail {
  subject: string
  text: string
  html: string
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** «12 октября» по Москве; пусто/мусор — null. */
export function formatDayMsk(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }).format(d)
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function isEmail(v: unknown): v is string {
  return typeof v === 'string' && EMAIL_RE.test(v.trim())
}

function firstName(full: string | null): string | null {
  const n = (full ?? '').trim().split(/\s+/)[0]
  return n ? n : null
}

/** Текст письма; ссылка — на «Мою подписку». */
export function buildMail(row: MailRow, cabinetUrl: string | null): Mail {
  const name = firstName(row.full_name)
  const hello = name ? `${name}, здравствуйте!` : 'Здравствуйте!'
  const course = row.course_title ? `«${row.course_title}»` : 'курс'
  const lines: string[] = []
  let subject: string

  if (row.kind === 'charge_failed') {
    subject = 'Не удалось продлить подписку'
    lines.push(`Не получилось списать оплату за подписку на ${course}: ${cancelReasonText(row.last_charge_error)}.`)
    const next = formatDayMsk(row.next_charge_at)
    const until = formatDayMsk(row.access_until)
    if (next) lines.push(`Повторим попытку ${next}.`)
    if (until) lines.push(`Доступ к курсу сохранится до ${until}.`)
    lines.push('Проверьте карту или оплатите месяц вручную в разделе «Моя подписка».')
  } else if (row.kind === 'expired') {
    subject = row.source === 'trial' ? 'Пробный период закончился' : 'Подписка закончилась'
    lines.push(`${row.source === 'trial' ? 'Пробный период' : 'Подписка'} на ${course} закончилась, доступ к курсу закрыт.`)
    lines.push('Прогресс и работы сохранены — оформите подписку, и всё вернётся на место.')
  } else {
    subject = 'Автопродление подписки отключено'
    const until = formatDayMsk(row.access_until)
    lines.push(`Вы отключили автопродление подписки на ${course}.`)
    lines.push(until ? `Курс открыт до ${until}, дальше деньги списываться не будут.` : 'Дальше деньги списываться не будут.')
    lines.push('Если это были не вы — включите автопродление в разделе «Моя подписка».')
  }

  const button = cabinetUrl ? `${cabinetUrl.replace(/\/+$/, '')}/my-subscription` : null
  const text = [hello, '', ...lines, ...(button ? ['', `Моя подписка: ${button}`] : []), '', 'Школа Almiron'].join('\n')
  const html = [
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#12234a">`,
    `<p>${escapeHtml(hello)}</p>`,
    ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
    button
      ? `<p><a href="${escapeHtml(button)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#1f55e0;color:#fff;text-decoration:none">Моя подписка</a></p>`
      : '',
    `<p style="color:#55607a">Школа Almiron</p>`,
    `</div>`,
  ].join('')
  return { subject, text, html }
}

export type MailDecision =
  | { send: true; request: { url: string; body: Record<string, unknown> } }
  | { send: false; skipped: string }

/**
 * Слать ли письмо. Нет ключа, отправителя или адреса — пропуск с причиной
 * (пишется в subscription_log как mail_skipped), остальное работает.
 */
export function planMail(
  row: MailRow,
  cfg: { apiKey: string | null | undefined; from: string | null | undefined; cabinetUrl: string | null | undefined },
): MailDecision {
  if (!cfg.apiKey) return { send: false, skipped: 'no_api_key' }
  if (!cfg.from) return { send: false, skipped: 'no_sender' }
  if (!isEmail(row.email)) return { send: false, skipped: 'no_email' }
  const mail = buildMail(row, cfg.cabinetUrl ?? null)
  return {
    send: true,
    request: {
      url: RESEND_API,
      body: { from: cfg.from, to: [row.email.trim()], subject: mail.subject, text: mail.text, html: mail.html },
    },
  }
}
