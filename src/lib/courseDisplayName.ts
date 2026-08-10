/**
 * Короткое имя копии курса в списке — только различающийся хвост.
 *
 * «Математика ЕГЭ. 1 часть + джентльменский набор — 11А» под своим шаблоном
 * показывается как «11А»: общая часть уже написана в карточке шаблона сверху,
 * и повторять её в каждой копии — шум (§114).
 *
 * ЭТО ТОЛЬКО ОТОБРАЖЕНИЕ В СПИСКЕ. Официальное название курса остаётся полным
 * везде — заголовок, программа, поиск, экспорт, письма, уведомления; в базу
 * короткое имя не пишется и в API не уходит. Функция чистая и ничего не знает
 * ни о запросах, ни о состоянии.
 */

/** Разделители, которые остаются висеть на срезе: « — 11А» → «11А». */
const DANGLING = /^[\s—–\-:·,.]+/

/**
 * Общий префикс считается ПО СЛОВАМ ЦЕЛИКОМ. Обрезка по символам дала бы
 * «1 ч» вместо «1 часть» — это хуже длинного имени, а не лучше.
 */
function words(value: string): string[] {
  return value.trim().split(/\s+/).filter(Boolean)
}

/**
 * Отображаемое имя копии рядом со своим шаблоном.
 *
 * Возвращает полное название, если сокращать нечего или опасно:
 *  - общего префикса нет вовсе (курс переименовали) — не выдумываем;
 *  - префикс совпал целиком, остаток пуст;
 *  - остаток короче двух символов — «А» вместо «11А» не опознать;
 *  - остаток совпал с полным названием.
 *
 * Молчаливо обрезать до пустоты нельзя: лучше длинно, чем никак.
 */
export function copyDisplayTitle(fullTitle: string, templateTitle: string | null | undefined): string {
  const full = (fullTitle ?? '').trim()
  if (!full || !templateTitle) return full

  const copyWords = words(full)
  const templateWords = words(templateTitle)

  let common = 0
  while (
    common < copyWords.length &&
    common < templateWords.length &&
    copyWords[common].toLocaleLowerCase('ru') === templateWords[common].toLocaleLowerCase('ru')
  ) {
    common++
  }
  if (common === 0) return full

  const rest = copyWords.slice(common).join(' ').replace(DANGLING, '').trim()
  if (rest.length < 2) return full
  if (rest === full) return full
  return rest
}
