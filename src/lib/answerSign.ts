/**
 * §267. Минус в поле ответа на iPhone.
 *
 * Цифровая клавиатура iOS (`inputMode="decimal"`) — только цифры и запятая,
 * знака «−» на ней нет. Поэтому рядом с полем ответа стоит кнопка «±»:
 * она ставит минус в начало ответа или убирает его.
 */
const LEADING_MINUS = /^[-−–—]/

/** Ставит «-» в начало ответа или убирает уже стоящий минус (любой из −, –, —). */
export function toggleMinus(value: string): string {
  const v = value.replace(/^\s+/, '')
  return LEADING_MINUS.test(v) ? v.slice(1) : `-${v}`
}

export function hasLeadingMinus(value: string): boolean {
  return LEADING_MINUS.test(value.replace(/^\s+/, ''))
}
