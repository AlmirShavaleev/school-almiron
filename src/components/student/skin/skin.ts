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
 * 3D-стикеры кабинета — набор лендинга, перекрашенный под бренд (синий и
 * оранжевый; исходники `D:\Задачник\ЛЕНДИНГ\3d-иконки\`, 3dicons.co, CC0),
 * WebP 256×256 в `public/brand/stu/`. Красные иконки лендинга
 * (`public/brand/icons`) в кабинете не используются: спорят с брендом.
 * `gift` — из новых (письмо ЛК_стиль_новые_3d_иконки.md, 15.10): единственный
 * красный акцент — плашка пробного периода.
 */
export const STICKERS = [
  'play', 'book', 'target', 'check', 'clock', 'bell', 'calendar', 'calendar25',
  'mail', 'lock', 'search', 'chat', 'rocket', 'gift',
] as const
export type StickerName = (typeof STICKERS)[number]

export const stickerSrc = (name: StickerName) => `/brand/stu/${name}.webp`
