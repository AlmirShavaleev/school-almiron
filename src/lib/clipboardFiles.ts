/**
 * Картинки из буфера обмена и перетаскивания.
 *
 * Код приехал из виджета «Сообщить о проблеме» — там вставка скриншота
 * появилась первой и обкаталась. Вынесен сюда, чтобы материалы темы и ДЗ
 * пользовались тем же обработчиком, а не своей копией: у буфера хватает
 * особенностей (см. ниже), и три версии одной логики разъехались бы.
 */

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

/** Как называем скриншот из буфера: «скриншот-3.png». */
const SCREENSHOT_RE = /^скриншот-(\d+)(?:\.[a-z0-9]+)?$/i

/**
 * Самый большой номер среди уже имеющихся «скриншот-N» в списке. Результат
 * отдаётся в `imagesFromTransfer` как `startIndex`, и следующая вставка
 * получает N+1.
 *
 * Считаем по именам, а не по длине списка: рядом лежат обычные файлы, и от
 * `files.length` номера скакали бы через один. Смотрим на ВЕСЬ список, включая
 * загруженное в прошлые заходы, — иначе после переоткрытия окна нумерация
 * начиналась бы заново и «скриншот-1» стало бы два (§99).
 */
export function nextScreenshotIndex(names: Array<string | null | undefined>): number {
  let max = 0
  for (const name of names) {
    const m = SCREENSHOT_RE.exec((name ?? '').trim())
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/**
 * Картинки из буфера обмена или перетаскивания. У скриншота из буфера имени
 * нет («image.png» или пусто) — даём своё, чтобы в списке вложений было видно,
 * что это и какое по счёту.
 */
export function imagesFromTransfer(dt: DataTransfer | null, startIndex = 0): File[] {
  if (!dt) return []

  const raw: File[] = []
  if (dt.items && dt.items.length > 0) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue
      const f = item.getAsFile()
      if (f) raw.push(f)
    }
  } else if (dt.files && dt.files.length > 0) {
    raw.push(...Array.from(dt.files))
  }

  return raw.map((f, i) => {
    const unnamed = !f.name || /^image\.(png|jpe?g|webp)$/i.test(f.name)
    if (!unnamed) return f
    const ext = EXT_BY_MIME[f.type] ?? '.png'
    return new File([f], `скриншот-${startIndex + i + 1}${ext}`, { type: f.type })
  })
}
