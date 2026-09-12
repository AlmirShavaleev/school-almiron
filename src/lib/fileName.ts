/**
 * Обрезка середины длинного имени файла: `IMG_20260911_очень_длинное_имя.jpg`
 * → `IMG_20260911_оч…ное_имя.jpg`. Расширение и хвост имени остаются видны —
 * по ним ученик и преподаватель отличают страницы (`_1.jpg`, `_2.jpg`);
 * обрезка с конца (`truncate`) прятала бы ровно их.
 *
 * Зачем вообще: имена с телефона всегда длинные, и один такой чип раздвигал
 * страницу шире экрана — телефон ужимал всю страницу (§158, аудит №6, №21).
 */
export const FILE_NAME_ELLIPSIS = '…'

export function middleEllipsis(name: string, max = 28): string {
  if (!name) return ''
  if (max < 5) max = 5
  if (name.length <= max) return name
  const dot = name.lastIndexOf('.')
  // Хвост: расширение плюс несколько символов имени перед ним, но не больше
  // трети лимита — иначе от начала имени не останется ничего.
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : ''
  // Хвост не длиннее max − 2: хотя бы один символ начала имени остаётся всегда.
  const tailLen = Math.min(Math.max(ext.length + 3, Math.floor(max / 3)), max - 2)
  const headLen = max - tailLen - FILE_NAME_ELLIPSIS.length
  return name.slice(0, headLen) + FILE_NAME_ELLIPSIS + name.slice(name.length - tailLen)
}
