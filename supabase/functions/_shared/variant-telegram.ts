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

/**
 * §219. Результат пробника — производитель `notify_mock_exam_results` (SQL),
 * по кнопке «Уведомить» / «Уведомить всех» на экране пробника. Числа
 * приходят числами, но payload — jsonb, поэтому разбираем осторожно.
 */
export interface MockExamResultTelegramPayload {
  title?: unknown
  exam_date?: unknown
  score?: unknown
  max_score?: unknown
  primary_score?: unknown
  primary_max?: unknown
  part1_score?: unknown
  part1_max?: unknown
  part2_score?: unknown
  part2_max?: unknown
  // §223. Статистика: считает SQL в момент «Уведомить».
  peers?: unknown        // сколько ДРУГИХ учеников группы с итогом
  better_pct?: unknown   // доля из них с итогом ниже, целые проценты; null — меньше трёх других
  is_best?: unknown      // итог не ниже ни у кого (при трёх и более других)
  prev_score?: unknown   // итог прошлого пробника того же шаблона
  prev_title?: unknown
}

/** «балл / балла / баллов» — своя копия: edge-функция не видит src/lib/plural.ts. */
function ballsWord(n: number): string {
  const m10 = Math.abs(n) % 10, m100 = Math.abs(n) % 100
  if (m10 === 1 && m100 !== 11) return 'балл'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'балла'
  return 'баллов'
}

function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function buildMockExamResultTelegramMessage(payload: MockExamResultTelegramPayload) {
  // Сквозные решения карточек (2026-08-03): исход в заголовке, к читателю не
  // обращаемся, подробности одной строкой через «·», даты по-русски.
  // Баллов по заданиям здесь нет намеренно (карточка 071): только итог и
  // части. Кнопки нет: страницы «мои пробники» у ученика нет (§215, пункт
  // меню закрыт) — вести кнопкой некуда.
  const of = (v: number, max: number | null) => (max != null ? `${v} из ${max}` : `${v}`)
  const score = intOrNull(payload.score)
  const max = intOrNull(payload.max_score)
  const primary = intOrNull(payload.primary_score)
  const primaryMax = intOrNull(payload.primary_max)
  const p1 = intOrNull(payload.part1_score)
  const p2 = intOrNull(payload.part2_score)
  const p1max = intOrNull(payload.part1_max)
  const p2max = intOrNull(payload.part2_max)

  const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : 'Пробник'
  const day = payload.exam_date ? formatDay(payload.exam_date) : ''

  const lines = [
    score != null
      ? `📊 <b>Результат пробника — ${escapeHtml(of(score, max))}</b>`
      : `📊 <b>Результат пробника</b>`,
    '',
    `«${escapeHtml(title)}»` + (day ? ` · ${escapeHtml(day)}` : ''),
  ]
  // С таблицей перевода итог — тестовый, а части — первичные: без строки
  // «первичный» 10 + 8 рядом с «72» выглядело бы ошибкой. §223: первичный —
  // сразу под итогом, части — под ним: от общего к частному.
  if (primary != null && primary !== score) lines.push(`Первичный балл — ${escapeHtml(of(primary, primaryMax))}`)
  const parts = [
    p1 != null ? `1 часть — ${of(p1, p1max)}` : null,
    p2 != null ? `2 часть — ${of(p2, p2max)}` : null,
  ].filter(Boolean) as string[]
  if (parts.length) lines.push(escapeHtml(parts.join(' · ')))
  // Владелец 26.09: под первичным и частями — отдельной строкой тестовый
  // балл словами, как в образце: «Результат: 72 балла из 100». Только когда
  // есть таблица перевода (итог ≠ первичный) — иначе строка повторяла бы
  // заголовок слово в слово.
  if (score != null && primary != null && primary !== score) {
    lines.push(`Результат: ${score} ${ballsWord(score)}${max != null ? ` из ${max}` : ''}`)
  }

  // §223. Статистика — отдельным абзацем. Место в группе только долей и
  // только когда других не меньше трёх (на двоих процент выдаёт чужой балл);
  // ноль не пишем — карточка сообщает, а не стыдит. Рядом — сколько
  // написали, чтобы процент был честным.
  const stats: string[] = []
  const peers = intOrNull(payload.peers)
  const pct = intOrNull(payload.better_pct)
  const written = peers != null ? `написали ${peers + 1}` : null
  if (payload.is_best === true && peers != null && peers >= 3) {
    stats.push(`🏆 Лучший результат в группе · ${written}`)
  } else if (pct != null && pct > 0 && peers != null && peers >= 3) {
    stats.push(`Лучше, чем ${pct}% группы · ${written}`)
  }
  const prev = intOrNull(payload.prev_score)
  if (prev != null && score != null) {
    const d = score - prev
    const prevTitle = typeof payload.prev_title === 'string' && payload.prev_title.trim() ? payload.prev_title.trim() : null
    const was = prevTitle ? `«${escapeHtml(prevTitle)}» — ${prev}` : `было ${prev}`
    stats.push(d === 0
      ? `Как на прошлом пробнике (${was})`
      : `${d > 0 ? '📈 +' : '📉 −'}${Math.abs(d)} к прошлому пробнику (${was})`)
  }
  if (stats.length) lines.push('', ...stats)

  return { text: lines.join('\n'), replyMarkup: null }
}

/**
 * §224. Напоминания о пробнике — производитель триггер
 * `mock_exam_schedule_notifications` на `mock_exams` (SQL): строки встают в
 * очередь заранее со `scheduled_for`, очередь сама ждёт момента.
 * Payload: title, starts_at, ends_at, photos_until (ISO), link.
 */
export interface MockExamStartTelegramPayload {
  title?: unknown
  starts_at?: unknown
  ends_at?: unknown
  photos_until?: unknown
  link?: unknown
}

/** «14:00» по Москве; не разобралось — пусто (строку со временем не пишем). */
export function formatClockMsk(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
}

function mockTitle(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim() : 'Пробник'
}

/**
 * «Через час — пробник». Приходит за час до начала (только если пробник
 * назначен раньше, чем за час). Кнопки нет: открывать пока нечего — страница
 * покажет только отсчёт; кнопка приходит со вторым сообщением, в начале.
 */
export function buildMockExamSoonTelegramMessage(payload: MockExamStartTelegramPayload) {
  const from = formatClockMsk(payload.starts_at)
  const to = formatClockMsk(payload.ends_at)
  const when = from && to ? `${from}–${to}` : from
  const lines = [
    '⏰ <b>Через час — пробник</b>',
    '',
    `«${escapeHtml(mockTitle(payload.title))}»` + (when ? ` · ${when}` : ''),
    'Нужны черновик, ручка и телефон для фото второй части',
  ]
  return { text: lines.join('\n'), replyMarkup: null }
}

/** «Пробник начался» — в момент начала, с кнопкой на страницу пробника. */
export function buildMockExamStartTelegramMessage(payload: MockExamStartTelegramPayload, appUrl: string) {
  const to = formatClockMsk(payload.ends_at)
  const photos = formatClockMsk(payload.photos_until)
  const lines = [
    '📝 <b>Пробник начался</b>',
    '',
    `«${escapeHtml(mockTitle(payload.title))}»` + (to ? ` · до ${to}` : ''),
  ]
  if (photos) lines.push(`Фото второй части — до ${photos}`)
  const link = typeof payload.link === 'string' ? payload.link : null
  return { text: lines.join('\n'), replyMarkup: buildLinkButton(link, appUrl, 'Открыть пробник') }
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
    // §224. Напоминания о пробнике («через час» и «начался») — под галочкой
    // «Домашние задания»: своей у пробников нет, а по смыслу это задание,
    // которое надо сделать. Ветки явные, чтобы решение было видно здесь.
    case 'mock_exam_soon':
    case 'mock_exam_started':
      return prefs.homework ?? true
    case 'lesson_reminder':
      return prefs.lesson ?? true
    case 'homework_reviewed':
    // Вердикт по ДЗ нового контура — та же настройка «проверено», что у легаси
    case 'topic_homework_reviewed':
    // §219. Результат пробника — тоже «проверено»: своей галочки у пробников
    // нет, а по смыслу это итог проверки. Выключил «Проверка ДЗ» — не шлём.
    case 'mock_exam_result':
      return prefs.checked ?? true
    // Сдача работы адресована персоналу, а галочки «сдачи» у преподавателя в
    // настройках нет — шлём всегда. Ветка заведена явно, чтобы это решение
    // было видно здесь, а не проваливалось молча в default.
    case 'topic_homework_submitted':
    // Обращение о проблеме — служебный сигнал админу, галочки под него нет.
    // Общий выключатель telegram выше по функции его всё равно гасит.
    case 'support_request':
    // Приветствие при вступлении в курс — разовое событие на курс, галочки под
    // него нет и заводить незачем: отключать «сообщите, что меня добавили»
    // нечему. Общий выключатель telegram выше по функции его гасит.
    case 'course_enrolled':
    // Зачисление глазами преподавателя — рабочий сигнал «к тебе записались».
    // Галочки под него нет: отключать «сообщите, что у меня новый ученик»
    // нечему. Общий выключатель telegram выше по функции его гасит.
    case 'course_student_enrolled':
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
