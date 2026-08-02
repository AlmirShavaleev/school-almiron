/**
 * Геометрия рамок в проверке работ.
 *
 * Координаты нормализованные (0..1), начало отсчёта — левый верхний угол
 * страницы. Здесь только чистые функции: перетаскивание и растягивание рамки
 * должны вести себя одинаково и под мышью, и под стрелками на клавиатуре, и
 * проверяться тестами без DOM.
 *
 * Два правила, ради которых это вынесено отдельно:
 *  1. Рамка никогда не выходит за страницу — иначе запись не пройдёт CHECK
 *     в базе (rect_x + rect_w <= 1.0001) и правка молча потеряется.
 *  2. При переносе размер сохраняется: у края рамка упирается, а не сплющивается.
 */

export type AnnotationRect = { x: number; y: number; w: number; h: number }

/** Восемь ручек: четыре угла и середины сторон. */
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Перенос рамки на (dx, dy). Ширина и высота не меняются: у границы страницы
 * рамка останавливается целиком — так преподаватель не получит вместо переноса
 * незаметно сжавшуюся рамку.
 */
export function moveRect(rect: AnnotationRect, dx: number, dy: number): AnnotationRect {
  return {
    x: clamp(rect.x + dx, 0, Math.max(0, 1 - rect.w)),
    y: clamp(rect.y + dy, 0, Math.max(0, 1 - rect.h)),
    w: rect.w,
    h: rect.h,
  }
}

/**
 * Растягивание за ручку. Двигаются только те стороны, которых ручка касается:
 * 'nw' — левая и верхняя, 'e' — только правая, и так далее. Противоположная
 * сторона стоит на месте, поэтому рамка не «убегает» из-под курсора.
 *
 * min — минимальный размер (MIN_REGION_SIZE у вызывающего): схлопнуть рамку в
 * ноль нельзя, иначе она станет невидимой и неудаляемой мышью.
 */
export function resizeRect(rect: AnnotationRect, handle: ResizeHandle, dx: number, dy: number, min: number): AnnotationRect {
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.w
  let bottom = rect.y + rect.h

  if (handle.includes('w')) left = clamp(left + dx, 0, right - min)
  if (handle.includes('e')) right = clamp(right + dx, left + min, 1)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, 1)

  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** Сравнение с допуском: пиксельное дрожание указателя не должно считаться правкой. */
export function rectsEqual(a: AnnotationRect, b: AnnotationRect, epsilon = 1e-6): boolean {
  return Math.abs(a.x - b.x) < epsilon
    && Math.abs(a.y - b.y) < epsilon
    && Math.abs(a.w - b.w) < epsilon
    && Math.abs(a.h - b.h) < epsilon
}

/**
 * Курсор для ручки. Держим рядом с геометрией: направление курсора и то, какие
 * стороны двигает ручка, — одно и то же знание.
 */
export const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'cursor-nwse-resize',
  se: 'cursor-nwse-resize',
  ne: 'cursor-nesw-resize',
  sw: 'cursor-nesw-resize',
  n: 'cursor-ns-resize',
  s: 'cursor-ns-resize',
  e: 'cursor-ew-resize',
  w: 'cursor-ew-resize',
}
