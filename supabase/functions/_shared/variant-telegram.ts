export interface VariantTelegramPayload {
  title?: string
  subject?: string | null
  exam_type?: string | null
  group_name?: string | null
  tasks_count?: number | null
  due_at?: string | null
  available_from?: string | null
  link?: string | null
  button_text?: string | null
}

export interface VariantDeadlineTelegramPayload {
  title?: string
  due_at?: string | null
  link?: string | null
  button_text?: string | null
}

export interface TelegramVariantPrefs {
  telegram?: boolean | null
  telegram_variant_assignments?: boolean | null
  homework?: boolean | null
  lesson?: boolean | null
  checked?: boolean | null
  lesson_changed?: boolean | null
}

const SUBJECT_LABELS: Record<string, string> = {
  math: 'Математика',
  physics: 'Физика',
}

const EXAM_LABELS: Record<string, string> = {
  ege: 'ЕГЭ',
  oge: 'ОГЭ',
}

/**
 * Дата для карточки: «7 августа, 19:30». Год в текущем году не пишем —
 * уведомление живёт часы, а не годы, и лишнее число только удлиняет строку.
 *
 * Но если год не наш, он появляется: «12 августа 0020, 03:00». Это не
 * украшение, а сигнал. В базе нашлись две работы с годом 0020 и 0002 — набран
 * руками; спрятав год, карточка сделала бы такую дату правдоподобной.
 *
 * Если значение не разбирается в дату вовсе, отдаём как есть: врать про дату
 * хуже, чем показать её кривой, а чинить надо в производителе.
 */
export function formatWhen(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  const sameYear = parsed.getUTCFullYear() === new Date().getUTCFullYear()
  // Дату и время склеиваем сами: toLocaleString с обоими наборами полей
  // вставляет «в» («12 июля в 19:45»), а утверждён вариант через запятую.
  const date = parsed.toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  })
  const time = parsed.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit',
  })
  return `${date}, ${time}`
}

/** Дата без времени: у дедлайна ДЗ в базе лежит date, часы там бессмысленны. */
export function formatDay(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  const sameYear = parsed.getUTCFullYear() === new Date().getUTCFullYear()
  return parsed.toLocaleDateString('ru-RU', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  })
}

/**
 * Telegram с `parse_mode: 'HTML'` падает на неэкранированных `&`, `<`, `>`
 * (400 «can't parse entities»), а такая ошибка классифицируется как постоянная
 * и сообщение теряется навсегда. В текст карточек попадают названия тем и
 * комментарии проверяющего — там `<` встречается в любом неравенстве.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Кнопка-ссылка для карточки. Возвращает `null`, если абсолютный URL собрать
 * не из чего — тогда карточка уходит просто без кнопки.
 *
 * Почему кнопка, а не `<a href>` в тексте: Telegram молча проглатывает якорь с
 * относительным href и печатает его содержимое обычным текстом. Сообщение при
 * этом уходит со статусом 200, и поломка не видна ни в очереди, ни в логах.
 * Кнопка с непригодным URL, наоборот, отбивается ошибкой 400 — отказ становится
 * заметным. Проверено на проде 2026-08-03.
 */
export function buildLinkButton(
  link: string | null | undefined,
  appUrl: string,
  label: string,
) {
  const url = buildAbsoluteUrl(appUrl, link)
  if (!url) return null
  return { inline_keyboard: [[{ text: label, url }]] }
}

export function buildAbsoluteUrl(appUrl: string, link: string | null | undefined): string | null {
  if (!link) return null
  if (/^https?:\/\//.test(link)) return link
  if (!appUrl) return null
  let parsedBase: URL
  try {
    parsedBase = new URL(appUrl)
  } catch {
    return null
  }
  if (
    parsedBase.hostname === 'localhost' ||
    parsedBase.hostname === '127.0.0.1' ||
    parsedBase.hostname === '::1'
  ) {
    return null
  }
  const base = appUrl.endsWith('/') ? appUrl.slice(0, -1) : appUrl
  const path = link.startsWith('/') ? link : `/${link}`
  return `${base}${path}`
}

export function buildVariantAssignedTelegramMessage(
  payload: VariantTelegramPayload,
  appUrl: string,
) {
  // Утверждено владельцем 2026-08-03: заголовок с названием, одна строка
  // подробностей через «·», срок отдельной строкой. Обращения «Вам» больше
  // нет — карточка сообщает факт, а не разговаривает. Строка «Откройте
  // вариант в личном кабинете» убрана: она дублировала кнопку под собой.
  const facts = [
    payload.subject ? (SUBJECT_LABELS[payload.subject] ?? payload.subject) : null,
    payload.exam_type ? (EXAM_LABELS[payload.exam_type] ?? payload.exam_type) : null,
    payload.group_name ?? null,
    payload.tasks_count != null ? `${payload.tasks_count} заданий` : null,
  ].filter(Boolean) as string[]

  const lines = [
    `📄 <b>Новый вариант — «${escapeHtml(payload.title ?? 'Без названия')}»</b>`,
    '',
  ]
  if (facts.length > 0) lines.push(facts.map(escapeHtml).join(' · '))
  if (payload.available_from) lines.push(`Откроется ${formatWhen(payload.available_from)}`)
  lines.push(payload.due_at ? `Сдать до ${formatWhen(payload.due_at)}` : 'Без дедлайна')

  const url = buildAbsoluteUrl(appUrl, payload.link)
  return {
    text: lines.join('\n'),
    replyMarkup: url && payload.button_text
      ? {
          inline_keyboard: [[{ text: payload.button_text, url }]],
        }
      : null,
  }
}

export function buildVariantDeadlineTelegramMessage(
  payload: VariantDeadlineTelegramPayload,
  appUrl: string,
) {
  // Утверждено владельцем 2026-08-03: новый срок в заголовке — он и есть
  // новость, ради которой сообщение пришло.
  const title = escapeHtml(payload.title ?? 'Вариант')
  const text = payload.due_at
    ? `⏳ <b>Новый срок сдачи — ${formatWhen(payload.due_at)}</b>\n\nВариант «${title}»`
    : `⏳ <b>Дедлайн снят</b>\n\nВариант «${title}» можно сдать в любое время.`

  const url = buildAbsoluteUrl(appUrl, payload.link)
  return {
    text,
    replyMarkup: url && payload.button_text
      ? {
          inline_keyboard: [[{ text: payload.button_text, url }]],
        }
      : null,
  }
}

export interface TgErrorInfo {
  isPermanent: boolean
  isBotBlocked: boolean
  safeMessage: string
}

export function classifyTelegramError(statusCode: number, description: string): TgErrorInfo {
  const desc = description.toLowerCase()
  const blockedPhrases = [
    'bot was blocked by the user',
    'user is deactivated',
    'chat not found',
    'bot can\'t initiate conversation with a user',
    'have no rights to send a message',
    'group chat was upgraded',
    'bot was kicked from',
  ]
  const isBotBlocked = statusCode === 403 ||
    (statusCode === 400 && blockedPhrases.some(p => desc.includes(p)))

  const permanentPhrases = [
    ...blockedPhrases,
    'wrong type of the web page content',
    'message is too long',
    'can\'t parse entities',
    'bad request',
  ]
  const isPermanent400 = statusCode === 400 && permanentPhrases.some(p => desc.includes(p))
  return {
    isPermanent: isBotBlocked || isPermanent400,
    isBotBlocked,
    safeMessage: `Telegram ${statusCode}: ${description.substring(0, 120)}`,
  }
}

export function isTelegramPreferenceEnabled(
  eventType: string,
  prefs: TelegramVariantPrefs | null | undefined,
) {
  if (!prefs?.telegram) return false

  switch (eventType) {
    case 'new_homework':
      return prefs.homework ?? true
    case 'lesson_reminder':
      return prefs.lesson ?? true
    case 'homework_reviewed':
    // Вердикт по ДЗ нового контура — та же настройка «проверено», что у легаси
    case 'topic_homework_reviewed':
    // Итог варианта — тоже вердикт по работе, галочка та же «проверено»
    case 'variant_graded':
      return prefs.checked ?? true
    // Сдача работы адресована персоналу, а галочки «сдачи» у преподавателя в
    // настройках нет — шлём всегда. Ветка заведена явно, чтобы это решение
    // было видно здесь, а не проваливалось молча в default.
    case 'topic_homework_submitted':
    // Обращение о проблеме — служебный сигнал админу, галочки под него нет.
    // Общий выключатель telegram выше по функции его всё равно гасит.
    case 'support_request':
      return true
    case 'lesson_rescheduled':
    case 'lesson_cancelled':
      return prefs.lesson_changed ?? true
    case 'variant_assigned':
    case 'variant_deadline_changed':
      return prefs.telegram_variant_assignments ?? true
    default:
      return true
  }
}
