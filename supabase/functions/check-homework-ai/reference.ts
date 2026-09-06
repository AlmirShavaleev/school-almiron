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

/** Сколько текста эталона уходит в промпт. Было 8000 (§32), стало 14000. */
export const REFERENCE_CHAR_LIMIT = 14_000

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
 * Обрезка эталона под промпт. Режем ХВОСТ, начало сохраняем: условие и первые
 * шаги решения важнее концовки. Факт обрезки возвращаем отдельно — модель
 * обязана знать, что продолжение не показано, иначе примет его отсутствие за
 * ошибку ученика.
 */
export function truncateReference(text: string, limit = REFERENCE_CHAR_LIMIT): ReferenceBlock {
  const clean = text.trim()
  if (clean.length <= limit) return { text: clean, truncated: false }
  return { text: clean.slice(0, limit).trimEnd(), truncated: true }
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
      ? 'Решение показано НЕ ЦЕЛИКОМ (обрезано по объёму): отсутствие продолжения не считай ошибкой ученика.'
      : '',
  ].filter(Boolean).join('\n')
}

/** Состояние эталона у проверки — попадает в панель преподавателя. */
export type ReferenceState = 'used' | 'missing' | 'failed'
