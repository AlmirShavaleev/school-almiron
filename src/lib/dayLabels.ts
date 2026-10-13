/**
 * Короткие подписи дня «YYYY-MM-DD» для карточки урока («Откроется 12 окт»,
 * «пт, 10 окт») и обзора ученика у персонала («28 сен»). Жили в календаре и
 * карточках главной (§254/§274: lib/studentCalendar, lib/studentHome); с
 * главной они ушли 14.10, подписи остались нужны этим экранам.
 *
 * День берётся как есть, без часового пояса браузера (полночь UTC).
 */
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const WEEKDAY_BY_UTC = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/

const keyDate = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`))

/** «пт, 10 окт» — день недели и число без года. */
export function shortDayLabel(day: string): string {
  if (!KEY_RE.test(day)) return ''
  const d = keyDate(day)
  return `${WEEKDAY_BY_UTC[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`
}

/** «12 окт» — подпись «Откроется 12 окт» на карточке урока. */
export function dayMonthShort(day: string): string {
  if (!KEY_RE.test(day)) return ''
  const d = keyDate(day)
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`
}

/** «28 сен» — короткая дата в таблицах обзора ученика (было studentHome.shortDay). */
export function shortDay(d: string): string {
  const [, m, dd] = d.split('-').map(Number)
  return `${dd} ${MONTHS_SHORT[m - 1]}`
}
