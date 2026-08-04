import { describe, expect, it } from 'vitest'
import { imagesFromTransfer } from '../clipboardFiles'

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
