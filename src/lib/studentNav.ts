/**
 * Меню ученика, вариант В (письмо ЛК_стиль_меню_ученика.md, 16.10): чистые
 * правила — метка «до 18 нояб» у «Подписки и курсов» и названия страниц в
 * шапке (у ученика свои: «Главная», «Курсы», «Банк задач»).
 */
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'нояб', 'дек']

interface SubLike { has_access: boolean; access_until: string | null; status: string }

/** «до 18 нояб» — ближайшее окончание открытой подписки или пробного; нет — null. */
export function subscriptionTag(subs: readonly SubLike[], now: Date = new Date()): string | null {
  const ends = subs
    .filter(s => s.has_access && s.access_until && new Date(s.access_until) > now)
    .map(s => s.access_until as string)
    .sort()
  if (ends.length === 0) return null
  const d = new Date(ends[0])
  const f = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'numeric', timeZone: 'Europe/Moscow' }).formatToParts(d)
  const day = f.find(p => p.type === 'day')?.value
  const month = Number(f.find(p => p.type === 'month')?.value)
  return day && month ? `до ${day} ${MONTHS[month - 1]}` : null
}

/** Названия страниц в шапке у ученика — по пунктам нового меню. */
const STUDENT_TITLES: Array<[RegExp, string]> = [
  [/^\/student\/?$/, 'Главная'],
  [/^\/my-course\/?$/, 'Курсы'],
  [/^\/catalog/, 'Банк задач'],
  [/^\/subscription\/?$/, 'Подписка и курсы'],
]

export function studentPageTitle(pathname: string): string | null {
  return STUDENT_TITLES.find(([re]) => re.test(pathname))?.[1] ?? null
}
