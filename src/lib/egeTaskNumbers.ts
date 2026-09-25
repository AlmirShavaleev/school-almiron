/**
 * §216. Номера заданий ЕГЭ у темы.
 *
 * Номер задания до §216 жил внутри названия темы обычным текстом («№13 —
 * Методы решения тригонометрических уравнений»), и собрать по нему статистику
 * было нельзя. Теперь у темы есть своё поле `topics.ege_task_numbers` —
 * СПИСОК номеров: номер часто не один («№1,17», «№13, 14, 15», «№22-23»).
 *
 * Здесь два разных разбора, и путать их не надо:
 *
 *   * `parseEgeNumbersInput` — то, что человек напечатал в поле редактора
 *     темы. Ввод свободный, ошибку надо показать словами.
 *   * `parseEgeNumbersFromTitle` — то, что удалось вытащить из НАЗВАНИЯ.
 *     Это близнец SQL-функции `public.ege_numbers_from_title(text)` из
 *     миграции §216, которой оркестратор разово заполняет базу. Близнец, а не
 *     тот же код: базу заполняет SQL, экран показывает TypeScript. Правила
 *     разбора у них обязаны совпадать, поэтому они выписаны в одних и тех же
 *     словах и покрыты одними и теми же случаями в тестах. Правишь один —
 *     правь второй.
 */

/** Разумные границы номера задания. Вне их — заведомо не номер (год, объём). */
export const EGE_NUMBER_MIN = 1
export const EGE_NUMBER_MAX = 40

/** Знак номера: кириллический «№» и латинские «Nº» / «N°» — на проде есть оба. */
const NUMBER_SIGN = /(?:№|[Nn][º°])/

function dedupeSorted(numbers: number[]): number[] {
  return Array.from(new Set(numbers)).sort((a, b) => a - b)
}

/** «13, 14, 15» для поля ввода и для показа. Пусто — пустая строка. */
export function formatEgeNumbers(numbers: readonly number[] | null | undefined): string {
  if (!numbers || numbers.length === 0) return ''
  return dedupeSorted([...numbers]).join(', ')
}

/**
 * Разбор ввода человека. Принимает «13, 14, 15», «1,17», «22-23», «№13»,
 * пробелы вместо запятых. Пустая строка — это «номера не заданы», а не ошибка:
 * стереть номера тема имеет право.
 */
export function parseEgeNumbersInput(raw: string): { numbers: number[]; error: string | null } {
  const cleaned = raw
    .replace(/№|[Nn][º°]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[;\s]+/g, ' ')
    .trim()

  if (cleaned === '') return { numbers: [], error: null }

  const out: number[] = []
  for (const piece of cleaned.split(/[,\s]+/)) {
    if (piece === '') continue
    const range = piece.match(/^(\d{1,2})-(\d{1,2})$/)
    if (range) {
      const lo = Number(range[1])
      const hi = Number(range[2])
      if (hi < lo) return { numbers: [], error: `Диапазон «${piece}» задом наперёд` }
      if (lo < EGE_NUMBER_MIN || hi > EGE_NUMBER_MAX) {
        return { numbers: [], error: `Номер должен быть от ${EGE_NUMBER_MIN} до ${EGE_NUMBER_MAX}` }
      }
      for (let n = lo; n <= hi; n++) out.push(n)
      continue
    }
    if (!/^\d{1,2}$/.test(piece)) {
      return { numbers: [], error: `«${piece}» — не номер задания` }
    }
    const n = Number(piece)
    if (n < EGE_NUMBER_MIN || n > EGE_NUMBER_MAX) {
      return { numbers: [], error: `Номер должен быть от ${EGE_NUMBER_MIN} до ${EGE_NUMBER_MAX}` }
    }
    out.push(n)
  }

  return { numbers: dedupeSorted(out), error: null }
}

/**
 * Разбор НАЗВАНИЯ темы. Близнец `public.ege_numbers_from_title(text)`.
 *
 * Ловит: «№» и «Nº»/«N°»; список через запятую («№1,17» → 1 и 17); диапазон
 * без пробелов вокруг дефиса («№22-23» → 22 и 23, «№1-12» → 1…12); несколько
 * знаков номера в одном названии.
 *
 * Не ловит намеренно: дефис С ПРОБЕЛАМИ («№13 — Методы…») — там тире отделяет
 * номер от темы, а не задаёт диапазон; числа длиннее двух цифр («№1-2026» —
 * это год); номера вне 1..40. Названия без знака номера дают пустой список, и
 * такие темы заполнение не трогает.
 */
export function parseEgeNumbersFromTitle(title: string | null | undefined): number[] {
  if (!title) return []
  const re = new RegExp(
    NUMBER_SIGN.source +
      '\\s*(\\d{1,2}(?!\\d)(?:-\\d{1,2}(?!\\d))?(?:\\s*,\\s*\\d{1,2}(?!\\d)(?:-\\d{1,2}(?!\\d))?)*)',
    'g',
  )
  const out: number[] = []
  for (const m of title.matchAll(re)) {
    for (const token of m[1].split(',')) {
      const piece = token.trim()
      if (piece === '') continue
      const [loRaw, hiRaw] = piece.split('-')
      const lo = Number(loRaw)
      const hi = hiRaw === undefined ? lo : Number(hiRaw)
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) continue
      for (let n = lo; n <= hi; n++) {
        if (n >= EGE_NUMBER_MIN && n <= EGE_NUMBER_MAX) out.push(n)
      }
    }
  }
  return dedupeSorted(out)
}
