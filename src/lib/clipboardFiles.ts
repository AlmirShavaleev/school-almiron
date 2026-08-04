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
