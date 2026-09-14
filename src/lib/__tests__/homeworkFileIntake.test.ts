import { describe, expect, it } from 'vitest'
import {
  HOMEWORK_FILE_ACCEPT,
  homeworkFileProblem,
  isAcceptedHomeworkFile,
  namePastedFile,
  splitHomeworkFiles,
} from '@/lib/topicHomework'

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

/**
 * §173. Через `image/*` прошли восемь `.dng` (Apple ProRAW) — пикер принял,
 * сжатие вернуло как есть, у преподавателя пусто. Отбор теперь по точному
 * списку того, что платформа показывает, и стоит до сжатия и Storage.
 */
describe('отбор файлов работы', () => {
  it('пускает PDF и картинки из точного списка: JPG, PNG, WebP, HEIC/HEIF', () => {
    expect(homeworkFileProblem(file('решение.pdf', 'application/pdf'))).toBeNull()
    expect(homeworkFileProblem(file('фото.jpg', 'image/jpeg'))).toBeNull()
    expect(homeworkFileProblem(file('снимок.png', 'image/png'))).toBeNull()
    expect(homeworkFileProblem(file('сжатое.webp', 'image/webp'))).toBeNull()
    expect(homeworkFileProblem(file('c телефона.heic', 'image/heic'))).toBeNull()
    expect(homeworkFileProblem(file('c телефона.heif', 'image/heif'))).toBeNull()
    // Регистр MIME не важен — судим по смыслу, не по написанию.
    expect(homeworkFileProblem(file('фото.jpg', 'IMAGE/JPEG'))).toBeNull()
  })

  it('DNG по MIME — отклоняет с объяснением про RAW без технических слов', () => {
    const problem = homeworkFileProblem(file('IMG_0001.DNG', 'image/x-adobe-dng'))
    expect(problem).toBe(
      'Этот формат (.dng) не откроется у преподавателя. ' +
      'Выключи RAW в камере (Настройки → Камера → Форматы) или сфотографируй заново.',
    )
    expect(problem).not.toMatch(/mime|image\/x-adobe/i)
  })

  it('DNG при пустом MIME — тот же отказ по расширению', () => {
    // iOS/Android-галереи для «сырых» снимков часто не сообщают тип вовсе.
    expect(homeworkFileProblem(file('IMG_0002.dng', ''))).toMatch(/\(\.dng\) не откроется у преподавателя/)
    expect(homeworkFileProblem(file('IMG_0002.dng', ''))).toMatch(/Выключи RAW/)
    // `application/octet-stream` — «тип неизвестен», а не «это бинарник»: тоже по расширению.
    expect(homeworkFileProblem(file('IMG_0003.dng', 'application/octet-stream'))).toMatch(/Выключи RAW/)
    expect(homeworkFileProblem(file('фото.jpg', 'application/octet-stream'))).toBeNull()
  })

  it('картинки вне списка (GIF, BMP, AVIF, TIFF) — не откроются, совет без «выключи RAW»', () => {
    // Раньше `image/*` пускал всё это; RAW тут ни при чём — не советуем выключать камеру.
    for (const [name, type] of [['анимация.gif', 'image/gif'], ['скан.bmp', 'image/bmp'], ['снимок.avif', 'image/avif'], ['скан.tiff', 'image/tiff']]) {
      const problem = homeworkFileProblem(file(name, type))
      expect(problem, name).toMatch(/не откроется у преподавателя/)
      expect(problem, name).not.toMatch(/RAW/)
      expect(problem, name).toMatch(/сфотографируй заново/)
    }
  })

  it('не пускает документы и архивы', () => {
    expect(homeworkFileProblem(file('решение.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')))
      .toMatch(/\(\.docx\) не откроется у преподавателя/)
    expect(homeworkFileProblem(file('всё.zip', 'application/zip'))).toMatch(/\(\.zip\)/)
    expect(isAcceptedHomeworkFile(file('всё.zip', 'application/zip'))).toBe(false)
  })

  it('когда браузер не сообщил тип — судит по расширению', () => {
    // Android-галереи и часть браузеров отдают пустой type.
    expect(homeworkFileProblem(file('скан.pdf', ''))).toBeNull()
    expect(homeworkFileProblem(file('фото.JPEG', ''))).toBeNull()
    expect(homeworkFileProblem(file('заметки.txt', ''))).toMatch(/\(\.txt\)/)
    expect(homeworkFileProblem(file('безымянный', ''))).toMatch(/\(без расширения\)/)
  })

  it('делит выбранное на подходящее и нет, сохраняя порядок и причину', () => {
    const { accepted, rejected } = splitHomeworkFiles([
      file('a.jpg', 'image/jpeg'),
      file('b.dng', 'image/x-adobe-dng'),
      file('c.jpg', 'image/jpeg'),
    ])
    expect(accepted.map(f => f.name)).toEqual(['a.jpg', 'c.jpg'])
    expect(rejected.map(r => r.file.name)).toEqual(['b.dng'])
    expect(rejected[0].problem).toMatch(/Выключи RAW/)
  })

  it('accept пикера — точный список, без image/*: тот же набор, что и у гейта', () => {
    // Точный accept — ещё и повод для iOS Safari самой конвертировать HEIC/ProRAW в JPEG.
    const parts = HOMEWORK_FILE_ACCEPT.split(',')
    expect(parts).not.toContain('image/*')
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']) {
      expect(parts).toContain(mime)
    }
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.pdf']) {
      expect(parts).toContain(ext)
    }
    // Каждая пара «MIME из accept + его расширение» проходит гейт — списки не разъехались.
    for (const p of parts) {
      const probe = p.startsWith('.') ? file(`x${p}`, '') : file('x', p)
      expect(homeworkFileProblem(probe), p).toBeNull()
    }
  })
})

describe('имена вставленных скриншотов', () => {
  it('безымянному снимку из буфера даёт понятное имя с номером', () => {
    // Из буфера скриншот приходит как image.png — и все подряд одинаково.
    expect(namePastedFile(file('image.png', 'image/png'), 0).name).toBe('Снимок экрана 1.png')
    expect(namePastedFile(file('image.png', 'image/png'), 1).name).toBe('Снимок экрана 2.png')
  })

  it('jpeg сокращает до jpg', () => {
    expect(namePastedFile(file('image.jpeg', 'image/jpeg'), 0).name).toBe('Снимок экрана 1.jpg')
  })

  it('осмысленное имя не трогает', () => {
    const f = file('решение задачи 5.png', 'image/png')
    expect(namePastedFile(f, 0)).toBe(f)
  })

  it('сохраняет содержимое и тип', () => {
    const renamed = namePastedFile(file('image.png', 'image/png'), 0)
    expect(renamed.type).toBe('image/png')
    expect(renamed.size).toBe(3)
  })
})
