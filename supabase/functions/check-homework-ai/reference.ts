/**
 * Авторский эталон для ИИ-проверки: разбор PDF, оценка качества, обрезка.
 *
 * Чистый модуль без Deno-API и без сети — ровно затем, чтобы его брал vitest.
 * Сеть и база живут в `index.ts`, здесь только решения, которые надо уметь
 * проверить тестом: годен ли разбор, каким движком идти дальше, сколько текста
 * отдать модели.
 *
 * Главная опасность этой работы — МОЛЧА принятый мусор. Решения у нас
 * математические; бесплатный движок на сканах формул возвращает кашу, каша
 * ляжет в кэш как эталон, и модель начнёт валить ученика за расхождение с ней.
 * Это было бы хуже, чем нынешнее отсутствие эталона. Поэтому «пусто или мусор»
 * определяется числом, а не на глаз.
 */

/** Порядок движков: сначала бесплатный, платный — только если первый не смог. */
export const FREE_ENGINE = 'cloudflare-ai'
export const OCR_ENGINE = 'mistral-ocr'
export type ParseEngine = typeof FREE_ENGINE | typeof OCR_ENGINE

/**
 * Умолчание у поставщика — ПЛАТНЫЙ `mistral-ocr`. Движок указываем всегда
 * явно, иначе бесплатный путь не используется вовсе.
 */
export const ENGINE_ORDER: readonly ParseEngine[] = [FREE_ENGINE, OCR_ENGINE] as const

/** Больше этого не разбираем: 4 материала из 844 на 16.08. */
export const MAX_REFERENCE_BYTES = 10 * 1024 * 1024

/**
 * Сколько текста эталона уходит в промпт. Было 8000 (§32), 14000 (§137),
 * с §149 — 40000 (≈11 тыс. токенов входа, доли цента на проверку, на фоне
 * картинок страниц незаметно). Решение владельца: 14000 резало решение в
 * 933 кБ, а медианный файл — 399 кБ, каждый десятый больше 1,4 МБ; обрезка
 * при 14000 была нормой, а не краем.
 */
export const REFERENCE_CHAR_LIMIT = 40_000

/**
 * Хвост эталона, который сохраняется при обрезке. В решениях Школково
 * таблица ответов стоит на ПОСЛЕДНЕЙ странице — самая ценная часть эталона.
 * Обрезка с хвоста (§137) на «Первой части» отрезала задачи 17–19 вместе с
 * таблицей ответов, и модель отметила ошибки ровно в 16–19 (прогон 11.09,
 * балл 73 при справедливых 100). §149.
 */
export const REFERENCE_TAIL_CHARS = 3_000

/** Разделитель на месте пропущенной середины — модель обязана его видеть. */
export const REFERENCE_GAP_MARK = '\n\n[… середина решения пропущена по объёму, ниже — конец документа …]\n\n'

/** Пороги «разбор годен». Ниже — считаем, что движок не справился. */
export const MIN_MEANINGFUL_TOTAL = 200
export const MIN_MEANINGFUL_PER_PAGE = 120

/**
 * Значимые символы: буквы и цифры. Пробелы, переносы и разметку не считаем —
 * пустой разбор часто возвращает страницы из одних `#`, `|` и переводов строк,
 * и по длине строки такой мусор неотличим от текста.
 */
export function meaningfulChars(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]/gu)
  return matches ? matches.length : 0
}

/**
 * Годен ли разбор. Считаем на страницу, а не на документ: у длинного решения
 * одна распознанная страница из десяти — это провал, хотя суммарно символов
 * набирается.
 */
export function isParseUsable(text: string, pages = 1): boolean {
  const meaningful = meaningfulChars(text)
  if (meaningful < MIN_MEANINGFUL_TOTAL) return false
  const perPage = meaningful / Math.max(1, pages)
  return perPage >= MIN_MEANINGFUL_PER_PAGE
}

/** Следующий движок после неудачного; null — дальше идти некуда. */
export function nextEngine(current: ParseEngine | null): ParseEngine | null {
  if (current === null) return ENGINE_ORDER[0]
  const index = ENGINE_ORDER.indexOf(current)
  return index >= 0 && index + 1 < ENGINE_ORDER.length ? ENGINE_ORDER[index + 1] : null
}

/**
 * Потолок строки с причинами отказа. Она уходит в `last_error`, а его читает
 * преподаватель в панели: две-три причины с числами быстро превращаются в
 * простыню. §149.
 */
export const MAX_FAILURE_REASON_CHARS = 500

/**
 * Причина «движок вернул слишком мало текста» — с числом. Без него «мало»
 * неотличимо от «пусто», а это разные поломки: пусто — движок не увидел
 * файл, мало — увидел скан и распознал крохи.
 */
export function tooLittleTextReason(engine: ParseEngine, text: string, pages: number): string {
  const meaningful = meaningfulChars(text)
  const pageCount = Math.max(1, pages)
  return `движок ${engine} вернул слишком мало текста (${meaningful} знач. симв. на ${pageCount} стр.)`
}

/**
 * Одна строка из причин ВСЕХ движков. Раньше в `last_error` уезжала причина
 * только последнего — пять прогонов подряд читали про баланс `mistral-ocr` и
 * ни разу про то, что случилось с бесплатным `cloudflare-ai`. Диагностика,
 * теряющая первую половину причины, уводит в сторону. §149.
 */
export function describeParseFailure(reasons: readonly string[]): string {
  const list = reasons.map(r => r.trim()).filter(Boolean)
  const joined = list.length > 0 ? list.join('; ') : 'разбор PDF не дал текста'
  const full = `Не удалось распознать авторское решение: ${joined}`
  return full.length > MAX_FAILURE_REASON_CHARS
    ? `${full.slice(0, MAX_FAILURE_REASON_CHARS - 1)}…`
    : full
}

export interface ParsedAnnotation {
  text: string
  pages: number
}

/**
 * Текст из `file_annotations` ответа поставщика.
 *
 * Берём ДОСЛОВНО разобранное содержимое, а не пересказ модели: пересказ
 * сокращает и «поправляет» формулы, а эталон обязан совпадать с тем, что
 * написал учитель. Аннотации приходят и в ветке ошибки инференса
 * (`error.metadata.file_annotations`) — значит даже провал модели отдаёт текст,
 * за который уже заплачено разбором.
 */
export function extractAnnotationText(payload: unknown): ParsedAnnotation {
  const root = payload as Record<string, any> | null
  const candidates: any[] = []

  const fromMessage = root?.choices?.[0]?.message?.annotations
  if (Array.isArray(fromMessage)) candidates.push(...fromMessage)

  const fromError = root?.error?.metadata?.file_annotations
  if (Array.isArray(fromError)) candidates.push(...fromError)

  const chunks: string[] = []
  let pages = 0

  for (const annotation of candidates) {
    const content = annotation?.file?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        chunks.push(part.text.trim())
        pages += 1
      }
    }
  }

  return { text: chunks.join('\n\n').trim(), pages: Math.max(pages, chunks.length > 0 ? 1 : 0) }
}

export interface ReferenceBlock {
  text: string
  truncated: boolean
}

/**
 * Обрезка эталона под промпт. Режем СЕРЕДИНУ: голова (условия и первые шаги)
 * и хвост (таблица ответов на последней странице) сохраняются, между ними —
 * явная пометка о пропуске. До §149 резали хвост, и таблица ответов уходила
 * первой. Факт обрезки возвращаем отдельно — модель обязана знать, что часть
 * не показана, иначе примет её отсутствие за ошибку ученика.
 */
export function truncateReference(
  text: string,
  limit = REFERENCE_CHAR_LIMIT,
  tail = REFERENCE_TAIL_CHARS,
): ReferenceBlock {
  const clean = text.trim()
  if (clean.length <= limit) return { text: clean, truncated: false }
  const tailLength = Math.min(tail, Math.max(0, limit - REFERENCE_GAP_MARK.length))
  const headLength = Math.max(0, limit - tailLength - REFERENCE_GAP_MARK.length)
  const head = clean.slice(0, headLength).trimEnd()
  const end = tailLength > 0 ? clean.slice(-tailLength).trimStart() : ''
  return { text: `${head}${REFERENCE_GAP_MARK}${end}`.trim(), truncated: true }
}

/**
 * Блок эталона для промпта — вместе с оговоркой о происхождении.
 *
 * Оговорка обязательна: текст получен распознаванием PDF, запись формул при
 * этом страдает. Без неё новая строгость выросла бы уже из кривого
 * распознавания — модель считала бы «x^2» вместо «x²» расхождением с автором.
 */
export function referencePromptBlock(block: ReferenceBlock): string {
  return [
    'АВТОРСКОЕ РЕШЕНИЕ УЧИТЕЛЯ (эталон):',
    block.text,
    '',
    'Про эталон: он получен автоматическим распознаванием PDF, форматирование и запись формул могли пострадать.',
    'Расхождение в ЗАПИСИ формулы ошибкой ученика не считай — сверяй смысл и результат.',
    block.truncated
      ? 'Решение показано НЕ ЦЕЛИКОМ: середина пропущена по объёму, начало и конец (таблица ответов) сохранены. Задание, чьё решение попало в пропуск, сверяй по таблице ответов; отсутствие пропущенных шагов не считай ошибкой ученика.'
      : '',
  ].filter(Boolean).join('\n')
}

/** Состояние эталона у проверки — попадает в панель преподавателя. */
export type ReferenceState = 'used' | 'missing' | 'failed'
