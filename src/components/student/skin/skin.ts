/**
 * Кабинет ученика в стиле лендинга (письмо ЛК_ученика_в_стиле_лендинга.md,
 * 14.10.2026) переводится по экранам. Здесь — какие экраны уже в новом виде:
 * остальные в тёмной теме рисуются светлым листом (`data-stu-scope='light'`),
 * потому что их цвета ещё заданы классами Tailwind под светлый фон.
 *
 * Этап 1: каркас (меню, шапка) и главная `/student`.
 */
const SKINNED: readonly RegExp[] = [
  /^\/student\/?$/,
]

export function studentSkinPage(pathname: string): boolean {
  return SKINNED.some(re => re.test(pathname))
}

/**
 * 3D-стикеры лендинга (`public/brand/icons`, 3dicons.co, CC0) под их смыслом
 * в кабинете. Имена файлов остались от аргументов лендинга, поэтому здесь —
 * что на картинке на самом деле.
 */
export const STICKER = {
  play: 'video',
  book: 'bank',
  target: 'forecast',
  check: 'autocheck',
  clock: 'check48',
  bell: 'bot',
  calendar: 'calendar',
  calendar25: 'mock',
  mail: 'mail',
  lock: 'unlock',
  search: 'diagnostic',
  chat: 'part2',
  rocket: 'rocket',
} as const
export type StickerName = keyof typeof STICKER

export const stickerSrc = (name: StickerName) => `/brand/icons/${STICKER[name]}.webp`
