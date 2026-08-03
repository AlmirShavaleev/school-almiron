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

function formatMoscowDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
  const lines = [
    'Новый вариант',
    '',
    `Вам назначен вариант «${payload.title ?? 'Без названия'}».`,
    '',
  ]

  if (payload.subject) lines.push(`Предмет: ${SUBJECT_LABELS[payload.subject] ?? payload.subject}`)
  if (payload.exam_type) lines.push(`Экзамен: ${EXAM_LABELS[payload.exam_type] ?? payload.exam_type}`)
  if (payload.group_name) lines.push(`Группа: ${payload.group_name}`)
  if (payload.tasks_count != null) lines.push(`Заданий: ${payload.tasks_count}`)

  if (payload.available_from) {
    lines.push(`Открытие: ${formatMoscowDateTime(payload.available_from)}`)
  }

  lines.push(
    `Дедлайн: ${payload.due_at ? formatMoscowDateTime(payload.due_at) : 'Без дедлайна'}`,
    '',
    'Откройте вариант в личном кабинете.',
  )

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
  const title = payload.title ?? 'Вариант'
  const text = payload.due_at
    ? `Изменён дедлайн варианта\n\nДля варианта «${title}» установлен новый дедлайн: ${formatMoscowDateTime(payload.due_at)}.`
    : `Изменён дедлайн варианта\n\nДля варианта «${title}» дедлайн отменён.`

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
