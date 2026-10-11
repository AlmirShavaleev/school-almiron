/**
 * Ассеты лендинга (правка 3, ЛЕНДИНГ_ПРАВКИ_3_диалог.md). Всё вынуто из
 * data-URI `лендинг_прототип_v2.html` как есть, не перерисовано:
 *  - 3D-иконки 3dicons.co (CC0) в цветах прототипа, 240×240 webp;
 *    `cross`/`tickg` — 96×96, маркеры списков «минус/плюс»;
 *  - фото владельца: вырезка для первого экрана и аватар чата.
 * Скриншоты платформы — из `скриншоты_платформы\` (уже обрезаны, личных
 * данных учеников нет).
 */
export const ICONS = [
  'video', 'bank', 'forecast', 'autocheck', 'check48', 'mock', 'calendar',
  'mail', 'unlock', 'bot', 'rocket', 'part2', 'diagnostic', 'cross', 'tickg',
] as const
export type IconName = (typeof ICONS)[number]

export const iconSrc = (name: IconName) => `/brand/icons/${name}.webp`

export const PHOTO = {
  cutout: { src: '/brand/photo/almir-cutout.webp', w: 487, h: 700 },
  avatar: { src: '/brand/photo/almir-avatar.webp', w: 160, h: 160 },
} as const

/** Реальные экраны платформы — в порядке вкладок «Так выглядит платформа». */
export const SCREENS = [
  { src: '/brand/screens/1_video.webp', w: 1235, h: 851 },
  { src: '/brand/screens/2_autocheck.webp', w: 1185, h: 665 },
  { src: '/brand/screens/3_part2_ai.webp', w: 1400, h: 491 },
  { src: '/brand/screens/4_bank.webp', w: 1400, h: 738 },
  { src: '/brand/screens/5_forecast.webp', w: 1280, h: 697 },
] as const
