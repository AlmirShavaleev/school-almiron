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

/**
 * §226. Поле в нижней строке экрана проверки v2. Над ним — фото работы, и
 * отдавать полю 40 % окна там нельзя: пустое оно в две строки, растёт под
 * подставленный разбор ИИ до четверти окна, дальше прокручивается. Нижний
 * предел (`COMMENT_MIN_MAX_HEIGHT`) тот же — на низком окне поле не схлопнется.
 */
export const BAR_COMMENT_ROWS = 2
export const BAR_COMMENT_MAX_FRACTION = 0.25
/**
 * На телефоне строка решения липкая и живёт под фото — там полю достаётся
 * седьмая часть окна (на 844 — около шести строк), и нижний предел свой:
 * общий 160 px съел бы треть видимой работы.
 */
export const BAR_COMMENT_MAX_FRACTION_NARROW = 0.14
export const BAR_COMMENT_MIN_MAX_HEIGHT = 96

/** Потолок в пикселях от высоты панели, в которой живёт форма вердикта. */
export function commentBoxMaxHeight(
  panelHeight: number,
  fraction: number = COMMENT_MAX_PANEL_FRACTION,
  floor: number = COMMENT_MIN_MAX_HEIGHT,
): number {
  if (!Number.isFinite(panelHeight) || panelHeight <= 0) return floor
  return Math.max(floor, Math.round(panelHeight * fraction))
}

/**
 * §226. Потолок поля в нижней строке экрана проверки: четверть окна с
 * ноутбука, седьмая часть на узком экране (ниже 1024 — там же, где колонки
 * уходят в одну).
 */
export function barCommentMaxHeight(windowWidth: number, windowHeight: number): number {
  return windowWidth >= 1024
    ? commentBoxMaxHeight(windowHeight, BAR_COMMENT_MAX_FRACTION)
    : commentBoxMaxHeight(windowHeight, BAR_COMMENT_MAX_FRACTION_NARROW, BAR_COMMENT_MIN_MAX_HEIGHT)
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
