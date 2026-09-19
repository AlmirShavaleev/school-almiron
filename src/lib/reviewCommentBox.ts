/**
 * §208. Поле комментария в форме вердикта: стартовая высота и потолок роста.
 *
 * Арифметика вынесена из компонента, потому что в ней две величины, которые
 * легко перепутать: высота, нужная содержимому, и высота, которую поле имеет
 * право занять. Здесь они видны рядом и проверяются тестом, а не глазами.
 */

/**
 * Сколько строк поле занимает пустым. Было две — владелец правит в этом поле
 * подставленный разбор ИИ и видел из него две строки; шесть показывают абзац
 * целиком и при этом не съедают экран у того, кто пишет одну фразу.
 */
export const COMMENT_ROWS = 6

/**
 * Доля высоты панели, выше которой поле не растёт. Потолок нужен не ради
 * красоты: без него длинный разбор ИИ выталкивает кнопки «Принять» и «Вернуть»
 * за нижний край, и решение по работе приходится искать прокруткой.
 */
export const COMMENT_MAX_PANEL_FRACTION = 0.4

/**
 * Ниже этого потолок не опускается. На низком окне (телефон боком, 360 px
 * высоты) 40 % — это меньше стартовых шести строк, и поле схлопывалось бы
 * сразу после открытия.
 */
export const COMMENT_MIN_MAX_HEIGHT = 160

/** Потолок в пикселях от высоты панели, в которой живёт форма вердикта. */
export function commentBoxMaxHeight(panelHeight: number): number {
  if (!Number.isFinite(panelHeight) || panelHeight <= 0) return COMMENT_MIN_MAX_HEIGHT
  return Math.max(COMMENT_MIN_MAX_HEIGHT, Math.round(panelHeight * COMMENT_MAX_PANEL_FRACTION))
}

/**
 * Высота поля под содержимое.
 *
 * `contentHeight` — сколько занимает текст (`scrollHeight` у поля без заданной
 * высоты), `minHeight` — высота пустого поля в его шесть строк. Прокрутка
 * включается ровно тогда, когда содержимое упёрлось в потолок: держать
 * постоянную полосу прокрутки в поле на шесть строк незачем, а без неё
 * упёршийся текст было бы не дочитать.
 */
export function commentBoxHeight(
  contentHeight: number,
  minHeight: number,
  maxHeight: number,
): { height: number; scroll: boolean } {
  const wanted = Math.max(Number.isFinite(contentHeight) ? contentHeight : 0, minHeight)
  if (wanted > maxHeight) return { height: maxHeight, scroll: true }
  return { height: wanted, scroll: false }
}
