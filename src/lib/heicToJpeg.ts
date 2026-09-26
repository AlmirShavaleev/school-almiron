import { splitHomeworkFiles, type RejectedHomeworkFile } from '@/lib/topicHomework'

/**
 * §229. Файлы второй части пробника: отбор как у домашки + HEIC → JPEG.
 *
 * Отбор формата — тот же `splitHomeworkFiles`, что у ДЗ (§173: RAW/.dng
 * отклоняется с подсказкой, PDF и картинки из точного списка — принимаются).
 * Лимит — тот же, что у бакетов ДЗ и пробников (50 МБ, `file_size_limit`):
 * здесь только чтобы сказать словами до загрузки, а не получить отказ
 * хранилища после.
 *
 * HEIC/HEIF с iPhone: Chrome и Firefox их не показывают — у преподавателя
 * было бы «Не удалось показать изображение». Библиотеку-конвертер не
 * подключаем: `node_modules` общий у нескольких клонов, а подходящего пакета
 * в нём нет (см. PROJECT_STATE §229). Переводим тем декодером, что есть в
 * браузере: Safari (откуда HEIC и приходят) и Chrome на macOS читают HEIC
 * сами — рисуем в canvas и сохраняем JPEG. Не смог браузер — понятный отказ
 * ДО загрузки: «сохраните как JPG».
 */

export const WORK_FILE_MAX_BYTES = 50 * 1024 * 1024

export const HEIC_REFUSAL =
  'Снимок в формате HEIC — этот браузер не смог перевести его в JPG. Сохраните фото как JPG ' +
  '(iPhone: Настройки → Камера → Форматы → «Наиболее совместимый») или сфотографируйте заново кнопкой «снять».'

const HEIC_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])

export function isHeic(file: { name: string; type?: string | null }): boolean {
  return HEIC_TYPES.has((file.type ?? '').toLowerCase()) || /\.(heic|heif)$/i.test(file.name)
}

/** Больше этого по длинной стороне не рисуем: дальше всё равно сожмёт `compressImageFile`. */
const MAX_SIDE = 2400
const DECODE_TIMEOUT_MS = 10_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))])
}

async function decode(file: File): Promise<{ source: CanvasImageSource; w: number; h: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await withTimeout(createImageBitmap(file), DECODE_TIMEOUT_MS)
      return { source: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close?.() }
    } catch { /* пробуем через <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await withTimeout(new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('decode'))
      img.src = url
    }), DECODE_TIMEOUT_MS)
    if (!img.naturalWidth) throw new Error('decode')
    return { source: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
}

/** HEIC → JPEG декодером браузера; не смог — null (без исключений). */
export async function heicToJpeg(file: File): Promise<File | null> {
  try {
    const d = await decode(file)
    try {
      const k = Math.min(1, MAX_SIDE / Math.max(d.w, d.h))
      const w = Math.max(1, Math.round(d.w * k))
      const h = Math.max(1, Math.round(d.h * k))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(d.source, 0, 0, w, h)
      const blob = await withTimeout(new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9)), DECODE_TIMEOUT_MS)
      if (!blob || blob.size === 0) return null
      return new File([blob], file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', { type: 'image/jpeg' })
    } finally {
      d.done()
    }
  } catch {
    return null
  }
}

/**
 * Отбор и подготовка файлов работы перед загрузкой: формат (как у ДЗ), HEIC →
 * JPEG, лимит размера. Порядок принятых — как выбрали.
 */
export async function prepareWorkFiles(
  files: File[],
  convert: (f: File) => Promise<File | null> = heicToJpeg,
): Promise<{ accepted: File[]; rejected: RejectedHomeworkFile[] }> {
  const { accepted, rejected } = splitHomeworkFiles(files)
  const out: File[] = []
  for (const f of accepted) {
    if (isHeic(f)) {
      const jpg = await convert(f)
      if (!jpg) { rejected.push({ file: f, problem: HEIC_REFUSAL }); continue }
      out.push(jpg)
      continue
    }
    if (f.size > WORK_FILE_MAX_BYTES) {
      rejected.push({ file: f, problem: 'Файл больше 50 МБ — не загрузится. Для PDF: сохраните его заново с меньшим качеством или пришлите фото страниц.' })
      continue
    }
    out.push(f)
  }
  return { accepted: out, rejected }
}
