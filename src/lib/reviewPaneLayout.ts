/**
 * Ширина панели «Решение задания» на экране проверки.
 *
 * Чистые функции — вся арифметика перетаскивания и хранения живёт здесь, чтобы
 * её можно было проверить тестом, а не глазами по скриншоту.
 *
 * Почему доля, а не пиксели: рабочая область у 1366 и у 1920 разная, и панель
 * в 40 % на широком экране читается, а те же 768 пикселей на ноутбуке съели бы
 * работу ученика целиком.
 */

/** Требование владельца 26.08: эталон ≈40 %, работа ученика ≈60 %. */
export const DEFAULT_SOLUTION_FRACTION = 0.4

/**
 * Границы перетаскивания. Уже 25 % — эталон снова нечитаем, ради чего всё и
 * затевалось; шире 60 % — работа ученика становится колодцем, а рамки ставить
 * приходится в щель.
 */
export const MIN_SOLUTION_FRACTION = 0.25
export const MAX_SOLUTION_FRACTION = 0.6

/**
 * С этой ширины окна панель занимает долю и её можно тянуть. Ниже — фиксированная
 * узкая колонка (20rem), ещё ниже 1024 — полоса сверху (см.
 * `SolutionReferencePanel`).
 *
 * Почему 1536, а не 1280. С 1280 `SubmissionReviewer` уже рисует третью колонку
 * комментариев (22rem = 352 px). На ноутбучных 1366 доля в 40 % оставила бы
 * документу 1366 − 546 − 352 ≈ 436 px — работать в такой щели нельзя. С
 * фиксированными 320 px документу остаётся ≈660 px, и это рабочая ширина.
 * На 1920 доля включается и даёт эталону 768 px против прежних 384.
 */
export const SPLIT_MIN_WIDTH = 1536

export const SOLUTION_FRACTION_STORAGE_KEY = 'review:solution-pane-fraction'

export function clampSolutionFraction(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SOLUTION_FRACTION
  return Math.min(MAX_SOLUTION_FRACTION, Math.max(MIN_SOLUTION_FRACTION, value))
}

/** Доля в CSS-проценты с одним знаком — чтобы не дёргался ререндер на дробях. */
export function fractionToPercent(fraction: number): string {
  return `${(clampSolutionFraction(fraction) * 100).toFixed(1)}%`
}

/**
 * Доля из положения указателя. `left` и `width` — прямоугольник рабочей области,
 * `clientX` — курсор или палец.
 */
export function fractionFromPointer(clientX: number, rect: { left: number; width: number }): number {
  if (!rect.width) return DEFAULT_SOLUTION_FRACTION
  return clampSolutionFraction((clientX - rect.left) / rect.width)
}

/**
 * Запомненная ширина. Хранилище может быть недоступно (приватное окно,
 * запрет на сайт) — тогда просто работаем с умолчанием, а не падаем.
 */
export function readSolutionFraction(storage?: Pick<Storage, 'getItem'>): number {
  try {
    const raw = (storage ?? window.localStorage).getItem(SOLUTION_FRACTION_STORAGE_KEY)
    if (!raw) return DEFAULT_SOLUTION_FRACTION
    return clampSolutionFraction(Number.parseFloat(raw))
  } catch {
    return DEFAULT_SOLUTION_FRACTION
  }
}

export function writeSolutionFraction(fraction: number, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(
      SOLUTION_FRACTION_STORAGE_KEY,
      String(clampSolutionFraction(fraction)),
    )
  } catch {
    /* ширина панели не стоит того, чтобы ронять разбор работы */
  }
}
