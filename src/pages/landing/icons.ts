/**
 * Ассеты лендинга (правка 3, ЛЕНДИНГ_ПРАВКИ_3_диалог.md). Всё вынуто из
 * data-URI `лендинг_прототип_v2.html` как есть, не перерисовано:
 *  - 3D-иконки 3dicons.co (CC0) в цветах прототипа, 240×240 webp;
 *    `cross`/`tickg` — 96×96, маркеры списков «минус/плюс»;
 *  - фото владельца — аватар чата (вырезка первого экрана ушла в правке 4).
 * Скриншоты платформы — из `скриншоты_платформы\` (уже обрезаны, личных
 * данных учеников нет).
 *
 * Правка 4 (лендинг_v3_6_аргументов.md): из `лендинг_прототип_v3.html` —
 * закат «Keep going» для первого экрана и вертикальный рабочий стол для
 * аргумента 1 (`SCENES`).
 */
export const ICONS = [
  'video', 'bank', 'forecast', 'autocheck', 'check48', 'mock', 'calendar',
  'mail', 'unlock', 'bot', 'rocket', 'part2', 'diagnostic', 'cross', 'tickg',
] as const
export type IconName = (typeof ICONS)[number]

export const iconSrc = (name: IconName) => `/brand/icons/${name}.webp`

export const PHOTO = {
  avatar: { src: '/brand/photo/almir-avatar.webp', w: 160, h: 160 },
} as const

export const SCENES = {
  sunset: { src: '/brand/scenes/sunset.webp', w: 736, h: 414 },
  desk: { src: '/brand/scenes/desk.webp', w: 736, h: 1104 },
} as const

/** Реальные экраны платформы — в порядке вкладок «Так выглядит платформа». */
export const SCREENS = [
  { src: '/brand/screens/1_video.webp', w: 1235, h: 851 },
  { src: '/brand/screens/2_autocheck.webp', w: 1185, h: 665 },
  { src: '/brand/screens/3_part2_ai.webp', w: 1400, h: 491 },
  { src: '/brand/screens/4_bank.webp', w: 1400, h: 738 },
  { src: '/brand/screens/5_forecast.webp', w: 1280, h: 697 },
] as const
