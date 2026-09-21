/**
 * §211. Поворот страницы работы.
 *
 * Ученики фотографируют тетрадь как придётся, и половина работ приезжает
 * боком. Кнопка у страницы доворачивает её на 90° по часовой стрелке, и
 * поворот запоминается рядом с пометками этой страницы
 * (`annotation_sets.data.rotation`, jsonb — миграции не нужно).
 *
 * ── Главное решение модуля ────────────────────────────────────────────────
 *
 * Прямоугольники пометок хранятся в координатах ИСХОДНОЙ страницы и НИКОГДА
 * не переписываются поворотом. Поворачивается только то, что показывается:
 * `rotateRect` переводит хранимые доли в доли повёрнутой страницы, а
 * `unrotateRect` — обратно, когда рамку нарисовали или подвинули на уже
 * повёрнутой странице.
 *
 * Почему не «повернуть и переписать в базу», как просит прямое прочтение
 * задачи, — две причины, и обе дорогие:
 *
 *  1. Четыре поворота подряд обязаны вернуть ТЕ ЖЕ числа. Пересчёт на месте
 *     этого не даёт: `1 - (1 - y)` в double — не `y` (при y = 0.1 выходит
 *     0.09999999999999998). Пометки медленно уезжали бы от каждого
 *     доворота, и заметил бы это уже ученик. Здесь же исходные числа просто
 *     лежат нетронутыми, а `rotateRect(rect, 4)` — это `rotateRect(rect, 0)`,
 *     то есть те же числа побайтово.
 *  2. Находки ИИ приходят в координатах исходного PDF (§180). Хранили бы мы
 *     повёрнутые — каждый перенос рамок пришлось бы доворачивать, и любая
 *     забытая ветка клала бы рамку мимо.
 *
 * Расплата одна: всякий, кто читает `region.rect`, обязан знать про угол
 * страницы. Поэтому экран считает `displayRect` один раз, рядом с
 * поверхностью, и дальше везде работает с ним.
 *
 * Система координат — как у всей разметки: доли 0..1 от ширины и высоты
 * страницы, начало в левом верхнем углу (`AnnotationRect`).
 */

import type { AnnotationRect } from './annotationGeometry'

/** Сколько четвертей оборота по часовой стрелке. */
export type Quarter = 0 | 1 | 2 | 3

/** Ровно столько поворотов возвращают страницу в исходное положение. */
export const QUARTER_TURNS = 4

/**
 * Приводит что угодно из jsonb к четверти оборота. Данные читаются из
 * `data.rotation`, где до §211 ничего не лежало, а после — может лежать что
 * угодно из чужой версии клиента: мусор обязан читаться как «не повёрнуто», а
 * не ронять разбор.
 */
export function normalizeQuarter(value: unknown): Quarter {
  const raw = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(raw)) return 0
  const turns = ((Math.trunc(raw) % QUARTER_TURNS) + QUARTER_TURNS) % QUARTER_TURNS
  return turns as Quarter
}

/** Следующее положение кнопки «повернуть»: шаг 90° по часовой стрелке. */
export function nextQuarter(quarter: unknown): Quarter {
  return normalizeQuarter(normalizeQuarter(quarter) + 1)
}

/** Угол в градусах — для pdf.js (`getViewport`) и для CSS `rotate()`. */
export function rotationDegrees(quarter: unknown): 0 | 90 | 180 | 270 {
  return (normalizeQuarter(quarter) * 90) as 0 | 90 | 180 | 270
}

/**
 * Хранимая рамка → рамка на повёрнутой странице.
 *
 * Вывод для одного поворота по часовой: точка (x, y) исходной страницы
 * оказывается в (1 − y, x) повёрнутой — верхний левый угол уезжает в правый
 * верхний. Для прямоугольника это значит, что стороны меняются местами:
 * ширина становится высотой и наоборот.
 */
export function rotateRect(rect: AnnotationRect, quarter: unknown): AnnotationRect {
  switch (normalizeQuarter(quarter)) {
    case 1: return { x: 1 - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w }
    case 2: return { x: 1 - rect.x - rect.w, y: 1 - rect.y - rect.h, w: rect.w, h: rect.h }
    case 3: return { x: rect.y, y: 1 - rect.x - rect.w, w: rect.h, h: rect.w }
    // Ноль отдаёт ТЕ ЖЕ числа, а не пересчитанные: на этом держится обещание
    // «четыре поворота подряд — исходные значения».
    default: return { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  }
}

/**
 * Рамка на повёрнутой странице → хранимая. Нужна ровно там, где рамку
 * нарисовали или подвинули глазами: в координатах экрана, на странице,
 * которую уже довернули.
 */
export function unrotateRect(rect: AnnotationRect, quarter: unknown): AnnotationRect {
  return rotateRect(rect, QUARTER_TURNS - normalizeQuarter(quarter))
}

/**
 * Отношение сторон (ширина к высоте) повёрнутой страницы. На 90° и 270°
 * страница ложится набок — и коробка под неё на экране, и лист в
 * скачиваемом PDF обязаны это знать.
 */
export function rotateRatio(ratio: number, quarter: unknown): number {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return ratio
  return normalizeQuarter(quarter) % 2 === 1 ? 1 / ratio : ratio
}
