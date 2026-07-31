import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HOMEWORK_PHOTO_PRESET,
  JPEG_ONLY_PRESET,
  MATERIAL_IMAGE_PRESET,
  compressImageFile,
  compressionRatio,
  fitWithin,
  isCompressibleImage,
  renameForType,
  shouldCompress,
} from './imageCompression'

function fakeFile(name: string, type: string, size: number): File {
  const file = new File([''], name, { type })
  // Настоящий File нужного объёма занял бы память впустую; для решений
  // о сжатии важен только заявленный размер.
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const MB = 1024 * 1024

describe('isCompressibleImage', () => {
  it('берёт растровые форматы, которые переживают canvas', () => {
    expect(isCompressibleImage({ type: 'image/jpeg' })).toBe(true)
    expect(isCompressibleImage({ type: 'image/png' })).toBe(true)
    expect(isCompressibleImage({ type: 'image/webp' })).toBe(true)
  })

  it('не трогает вектор, анимацию и форматы, которые браузер не декодирует', () => {
    expect(isCompressibleImage({ type: 'image/svg+xml' })).toBe(false)
    expect(isCompressibleImage({ type: 'image/gif' })).toBe(false)
    expect(isCompressibleImage({ type: 'image/heic' })).toBe(false)
    expect(isCompressibleImage({ type: 'application/pdf' })).toBe(false)
  })

  it('переживает пустой и незаданный тип', () => {
    expect(isCompressibleImage({ type: '' })).toBe(false)
    expect(isCompressibleImage({ type: null })).toBe(false)
    expect(isCompressibleImage({})).toBe(false)
  })

  it('не зависит от регистра', () => {
    expect(isCompressibleImage({ type: 'IMAGE/JPEG' })).toBe(true)
  })
})

describe('shouldCompress', () => {
  it('пропускает мелкие файлы: выигрыш не окупает риска', () => {
    expect(shouldCompress({ type: 'image/jpeg', size: 100 * 1024 })).toBe(false)
    expect(shouldCompress({ type: 'image/jpeg', size: 4 * MB })).toBe(true)
  })

  it('порог берётся из пресета', () => {
    const strict = { ...MATERIAL_IMAGE_PRESET, skipBelowBytes: 10 * MB }
    expect(shouldCompress({ type: 'image/jpeg', size: 4 * MB }, strict)).toBe(false)
  })

  it('размер не спасает PDF: несжимаемый тип отсекается первым', () => {
    expect(shouldCompress({ type: 'application/pdf', size: 40 * MB })).toBe(false)
  })
})

describe('fitWithin', () => {
  it('вписывает длинную сторону, сохраняя пропорции', () => {
    expect(fitWithin(4032, 3024, 2400)).toEqual({ width: 2400, height: 1800 })
    expect(fitWithin(3024, 4032, 2400)).toEqual({ width: 1800, height: 2400 })
  })

  it('не увеличивает то, что и так меньше рамки', () => {
    expect(fitWithin(800, 600, 2400)).toEqual({ width: 800, height: 600 })
  })

  it('ровно по границе ничего не меняет', () => {
    expect(fitWithin(2400, 1000, 2400)).toEqual({ width: 2400, height: 1000 })
  })

  it('у вытянутой полоски короткая сторона не схлопывается в ноль', () => {
    const { height } = fitWithin(20000, 3, 2000)
    expect(height).toBeGreaterThanOrEqual(1)
  })

  it('нулевые размеры возвращает как есть, не деля на ноль', () => {
    expect(fitWithin(0, 0, 2400)).toEqual({ width: 0, height: 0 })
  })
})

describe('renameForType', () => {
  it('меняет расширение под новый формат', () => {
    expect(renameForType('работа.jpg', 'image/webp')).toBe('работа.webp')
    expect(renameForType('scan.PNG', 'image/jpeg')).toBe('scan.jpg')
  })

  it('не режет имя по точкам внутри', () => {
    expect(renameForType('задача 5.2 вариант.jpeg', 'image/webp')).toBe('задача 5.2 вариант.webp')
  })

  it('дописывает расширение, если его не было', () => {
    expect(renameForType('photo', 'image/webp')).toBe('photo.webp')
  })

  it('не принимает точку в начале за расширение', () => {
    expect(renameForType('.hidden', 'image/webp')).toBe('.hidden.webp')
  })

  it('незнакомый тип оставляет имя нетронутым', () => {
    expect(renameForType('file.jpg', 'application/octet-stream')).toBe('file.jpg')
  })
})

describe('compressionRatio', () => {
  it('считает, во сколько раз стало легче', () => {
    expect(compressionRatio(4_000_000, 400_000)).toBe(10)
  })

  it('не делит на ноль', () => {
    expect(compressionRatio(4 * MB, 0)).toBe(1)
  })
})

describe('пресеты', () => {
  it('работы учеников хранятся крупнее прочих картинок: их читают с увеличением', () => {
    expect(HOMEWORK_PHOTO_PRESET.maxDimension).toBeGreaterThan(MATERIAL_IMAGE_PRESET.maxDimension)
    expect(HOMEWORK_PHOTO_PRESET.quality).toBeGreaterThanOrEqual(MATERIAL_IMAGE_PRESET.quality)
  })

  it('для бакета без webp в списке разрешённых типов есть JPEG-пресет', () => {
    expect(JPEG_ONLY_PRESET.outputType).toBe('image/jpeg')
  })
})

describe('compressImageFile: отказ никогда не ломает загрузку', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('несжимаемый файл возвращается тем же объектом', async () => {
    const pdf = fakeFile('дз.pdf', 'application/pdf', 8 * MB)
    await expect(compressImageFile(pdf)).resolves.toBe(pdf)
  })

  it('мелкая картинка возвращается тем же объектом', async () => {
    const small = fakeFile('схема.png', 'image/png', 50 * 1024)
    await expect(compressImageFile(small)).resolves.toBe(small)
  })

  it('без работающего canvas отдаёт оригинал, а не падает', async () => {
    // Так ведёт себя браузер с отключённым canvas: контекст не выдаётся.
    // Ученик всё равно обязан сдать работу — пусть и без сжатия.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const photo = fakeFile('фото.jpg', 'image/jpeg', 5 * MB)
    await expect(compressImageFile(photo, HOMEWORK_PHOTO_PRESET)).resolves.toBe(photo)
  })

  it('отказ кодировщика возвращает оригинал', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext())
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(null))
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4032, height: 3024, close() {} }))
    const photo = fakeFile('фото.jpg', 'image/jpeg', 5 * MB)
    await expect(compressImageFile(photo, HOMEWORK_PHOTO_PRESET)).resolves.toBe(photo)
  })

  it('результат тяжелее оригинала отбрасывается', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext())
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb =>
      cb(new Blob([new Uint8Array(10)], { type: 'image/webp' })),
    )
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4032, height: 3024, close() {} }))
    const tiny = fakeFile('уже сжато.jpg', 'image/jpeg', 5)
    // Порог пропуска обходим намеренно: проверяем именно сравнение размеров.
    const preset = { ...HOMEWORK_PHOTO_PRESET, skipBelowBytes: 0 }
    await expect(compressImageFile(tiny, preset)).resolves.toBe(tiny)
  })

  it('удачное сжатие даёт новый файл с согласованными именем, типом и размером', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext())
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb =>
      cb(new Blob([new Uint8Array(400)], { type: 'image/webp' })),
    )
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4032, height: 3024, close() {} }))

    const photo = fakeFile('фото работы.jpg', 'image/jpeg', 5 * MB)
    const out = await compressImageFile(photo, HOMEWORK_PHOTO_PRESET)

    expect(out).not.toBe(photo)
    expect(out.name).toBe('фото работы.webp')
    expect(out.type).toBe('image/webp')
    expect(out.size).toBe(400)
  })
})

/**
 * Минимальный 2d-контекст: сжатию нужны только заливка и отрисовка,
 * а jsdom без нативного canvas не даёт ни того, ни другого.
 */
function fakeContext() {
  return {
    fillStyle: '',
    fillRect: () => {},
    drawImage: () => {},
  } as unknown as CanvasRenderingContext2D
}
