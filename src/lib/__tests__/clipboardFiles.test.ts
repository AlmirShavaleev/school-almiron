import { describe, expect, it } from 'vitest'
import { imagesFromTransfer, nextScreenshotIndex } from '../clipboardFiles'

function png(name: string): File {
  return new File([new Uint8Array(8)], name, { type: 'image/png' })
}

/** DataTransfer в jsdom не конструируется — подсовываем то же, что читает код. */
function transfer(items: Array<{ kind: string; file?: File }>): DataTransfer {
  return {
    items: items.map(i => ({ kind: i.kind, getAsFile: () => i.file ?? null })),
    files: [],
  } as unknown as DataTransfer
}

describe('imagesFromTransfer', () => {
  it('без буфера возвращает пусто', () => {
    expect(imagesFromTransfer(null)).toEqual([])
  })

  it('берёт только файлы, строки игнорирует', () => {
    const dt = transfer([{ kind: 'string' }, { kind: 'file', file: png('снимок.png') }])
    expect(imagesFromTransfer(dt)).toHaveLength(1)
  })

  it('безымянному скриншоту даёт имя со счётом', () => {
    const dt = transfer([{ kind: 'file', file: png('image.png') }])
    expect(imagesFromTransfer(dt)[0].name).toBe('скриншот-1.png')
  })

  it('нумерация продолжается от переданного смещения', () => {
    const dt = transfer([{ kind: 'file', file: png('image.png') }])
    expect(imagesFromTransfer(dt, 2)[0].name).toBe('скриншот-3.png')
  })

  it('осмысленное имя файла сохраняет как есть', () => {
    const dt = transfer([{ kind: 'file', file: png('конспект.png') }])
    expect(imagesFromTransfer(dt)[0].name).toBe('конспект.png')
  })

  it('расширение берётся из типа, а не из имени', () => {
    const jpeg = new File([new Uint8Array(4)], 'image.png', { type: 'image/jpeg' })
    const dt = transfer([{ kind: 'file', file: jpeg }])
    expect(imagesFromTransfer(dt)[0].name).toBe('скриншот-1.jpg')
  })
})

describe('nextScreenshotIndex', () => {
  it('пустой список — нумерация с первого', () => {
    expect(nextScreenshotIndex([])).toBe(0)
  })

  it('считает по именам, а не по длине списка', () => {
    // Рядом лежат обычные файлы: от files.length номера скакали бы через один.
    expect(nextScreenshotIndex(['конспект.pdf', 'скриншот-1.png', 'задачи.pdf'])).toBe(1)
  })

  it('берёт максимальный номер, а не последний', () => {
    expect(nextScreenshotIndex(['скриншот-3.png', 'скриншот-1.png'])).toBe(3)
  })

  it('не спотыкается о null и пустые имена', () => {
    expect(nextScreenshotIndex([null, undefined, '', 'скриншот-2.jpg'])).toBe(2)
  })

  it('похожие имена за свои не считает', () => {
    expect(nextScreenshotIndex(['скриншот.png', 'мой-скриншот-7.png', 'скриншот-7-финал.png'])).toBe(0)
  })

  it('связка со смещением даёт следующий номер', () => {
    const dt = transfer([{ kind: 'file', file: png('image.png') }])
    const from = nextScreenshotIndex(['скриншот-1.png', 'скриншот-2.png'])
    expect(imagesFromTransfer(dt, from)[0].name).toBe('скриншот-3.png')
  })
})
