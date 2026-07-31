/**
 * Сжатие картинок в браузере перед отправкой в Storage.
 *
 * Зачем. Фотография страницы с телефона — это 3–6 МБ и 4000 пикселей по
 * длинной стороне. Читать рукописный текст при таком разрешении не нужно
 * ни человеку, ни модели: 2400 пикселей хватает с запасом, а вес падает
 * в 5–10 раз. Каталог задач уже переехал на R2 после того, как бесплатная
 * квота Supabase кончилась именно из-за объёма картинок; работы учеников
 * растут так же, только медленнее, и лечится это дешевле всего здесь —
 * до загрузки, а не переносом хранилища потом.
 *
 * Главное правило: сжатие не имеет права ломать загрузку. Любая осечка —
 * неизвестный формат, отказ декодера, отсутствие canvas в окружении,
 * результат тяжелее оригинала — возвращает исходный файл, и загрузка идёт
 * как раньше. Поэтому здесь нет ни одного `throw`.
 *
 * Что сознательно не трогаем:
 *  - SVG — вектор, растеризация только испортит и раздует;
 *  - GIF — покадровая анимация не переживёт canvas;
 *  - HEIC/HEIF с айфонов — браузеры их не декодируют, а Safari отдаёт
 *    такие снимки уже как JPEG;
 *  - PDF и всё остальное — не картинки.
 */

export interface CompressionPreset {
  /** Максимальная длинная сторона в пикселях. Пропорции сохраняются. */
  maxDimension: number
  /** Качество кодировщика, 0..1. */
  quality: number
  /** Во что перекодируем. */
  outputType: 'image/webp' | 'image/jpeg'
  /** Файлы легче этого порога не трогаем — выигрыш не окупает риска. */
  skipBelowBytes: number
}

/**
 * Работы учеников: фото тетради, которое преподаватель будет разглядывать
 * с увеличением, а модель — искать в нём строки. Разрешение чуть выше
 * остальных пресетов, качество тоже.
 */
export const HOMEWORK_PHOTO_PRESET: CompressionPreset = {
  maxDimension: 2400,
  quality: 0.85,
  outputType: 'image/webp',
  skipBelowBytes: 300 * 1024,
}

/** Материалы темы и урока: конспекты, схемы, скриншоты. */
export const MATERIAL_IMAGE_PRESET: CompressionPreset = {
  maxDimension: 2000,
  quality: 0.82,
  outputType: 'image/webp',
  skipBelowBytes: 300 * 1024,
}

/**
 * Для бакетов, где список разрешённых типов не включает webp
 * (`course-materials` — pdf/png/jpeg/docx/pptx). Загрузка webp туда
 * вернулась бы отказом Storage, поэтому кодируем в JPEG.
 */
export const JPEG_ONLY_PRESET: CompressionPreset = {
  ...MATERIAL_IMAGE_PRESET,
  outputType: 'image/jpeg',
}

/** Форматы, которые безопасно перекодировать через canvas. */
const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/** Картинка ли это в формате, который мы умеем пережимать. */
export function isCompressibleImage(file: { type?: string | null }): boolean {
  return COMPRESSIBLE_TYPES.has((file.type ?? '').toLowerCase())
}

/**
 * Решение «трогать или нет» до всякого декодирования.
 * Мелкие файлы пропускаем: экономия в пару десятков килобайт не стоит
 * ни задержки, ни риска потерять качество.
 */
export function shouldCompress(
  file: { type?: string | null; size: number },
  preset: CompressionPreset = MATERIAL_IMAGE_PRESET,
): boolean {
  if (!isCompressibleImage(file)) return false
  return file.size > preset.skipBelowBytes
}

/**
 * Новые размеры при вписывании в квадрат `max`. Пропорции сохраняются,
 * картинка меньше рамки не увеличивается. Округление вниз, но не до нуля:
 * очень вытянутая полоска должна остаться хотя бы в один пиксель, иначе
 * canvas откажется рисовать.
 */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width, height }
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Имя файла под новый формат: «работа.jpg» → «работа.webp».
 * Расширение должно совпадать с содержимым — иначе скачанный файл
 * не откроется двойным щелчком, а браузер в превью будет спорить
 * с Content-Type.
 */
export function renameForType(fileName: string, mimeType: string): string {
  const ext = EXTENSION_BY_TYPE[mimeType.toLowerCase()]
  if (!ext) return fileName
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  return `${base}.${ext}`
}

/** Во сколько раз файл стал легче. Для журналов и подсказок в интерфейсе. */
export function compressionRatio(originalBytes: number, compressedBytes: number): number {
  if (compressedBytes <= 0) return 1
  return originalBytes / compressedBytes
}

/** Сколько ждём декодирования, прежде чем сдаться и грузить оригинал. */
export const DECODE_TIMEOUT_MS = 15_000

/** Декодирование с учётом EXIF-поворота: фото с телефона иначе ложится боком. */
async function decode(file: File): Promise<{ width: number; height: number; source: CanvasImageSource } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { width: bitmap.width, height: bitmap.height, source: bitmap }
    } catch {
      // Старый Safari не знает imageOrientation — пробуем без него.
      try {
        const bitmap = await createImageBitmap(file)
        return { width: bitmap.width, height: bitmap.height, source: bitmap }
      } catch {
        return null
      }
    }
  }

  if (typeof Image !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return null
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      // Без таймера отказ декодера, при котором не приходит ни onload,
      // ни onerror, оставил бы кнопку загрузки крутиться навсегда.
      const timer = setTimeout(() => reject(new Error('decode timeout')), DECODE_TIMEOUT_MS)
      el.onload = () => { clearTimeout(timer); resolve(el) }
      el.onerror = () => { clearTimeout(timer); reject(new Error('decode failed')) }
      el.src = url
    })
    return { width: img.naturalWidth, height: img.naturalHeight, source: img }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => {
    try {
      canvas.toBlob(blob => resolve(blob), type, quality)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Пережимает картинку под пресет. Возвращает НОВЫЙ File — или тот же самый,
 * если сжимать нечего, нельзя или бессмысленно.
 *
 * Вызывающему коду важно брать имя, тип и размер именно из результата:
 * после перекодирования они меняются, и запись в БД должна описывать то,
 * что реально легло в Storage.
 */
export async function compressImageFile(
  file: File,
  preset: CompressionPreset = MATERIAL_IMAGE_PRESET,
): Promise<File> {
  if (!shouldCompress(file, preset)) return file
  if (typeof document === 'undefined') return file

  try {
    // Canvas проверяем ДО декодирования: без него сжатие невозможно, а
    // декодирование многомегабайтного снимка стоит времени и памяти.
    // Заодно это делает функцию безопасной в тестовой среде без canvas.
    const canvas = document.createElement('canvas')
    if (typeof canvas.toBlob !== 'function') return file
    const ctx = canvas.getContext('2d')
    if (!ctx) return file

    const decoded = await decode(file)
    if (!decoded || decoded.width <= 0 || decoded.height <= 0) return file

    const { width, height } = fitWithin(decoded.width, decoded.height, preset.maxDimension)
    canvas.width = width
    canvas.height = height

    // JPEG не умеет прозрачность: без подложки прозрачные места станут
    // чёрными. Белый — то, чего ожидают от скана листа.
    if (preset.outputType === 'image/jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(decoded.source, 0, 0, width, height)

    let blob = await toBlob(canvas, preset.outputType, preset.quality)

    // Если webp не поддержан, canvas молча отдаёт PNG — он для фотографии
    // тяжелее оригинала. Пробуем JPEG, он есть везде.
    if (blob && blob.type !== preset.outputType && preset.outputType === 'image/webp') {
      blob = await toBlob(canvas, 'image/jpeg', preset.quality)
    }

    if (!blob || blob.size === 0) return file
    // Уже оптимизированную картинку перекодирование может только раздуть.
    if (blob.size >= file.size) return file

    return new File([blob], renameForType(file.name, blob.type), {
      type: blob.type,
      lastModified: file.lastModified,
    })
  } catch {
    // Сжатие — необязательная оптимизация. Всё, что пошло не так,
    // не должно мешать ученику сдать работу.
    return file
  }
}
