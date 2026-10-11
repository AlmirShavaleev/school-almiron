/**
 * Правка 2 (ЛЕНДИНГ_ПРАВКИ_2_иконки.md): 3D-иконки 3dicons.co, CC0. Файлы уже
 * перекрашены в цвета бренда и сжаты владельцем — лежат в
 * `public/brand/icons/` как есть, 320×320 webp на прозрачном фоне.
 */
export const ICONS = [
  'hero-rocket', 'video', 'bank', 'autocheck', 'part2', 'mock', 'forecast',
  'unlock', 'bot', 'check48', 'diagnostic', 'calendar', 'mail', 'trophy',
] as const
export type IconName = (typeof ICONS)[number]

export const iconSrc = (name: IconName) => `/brand/icons/${name}.webp`
