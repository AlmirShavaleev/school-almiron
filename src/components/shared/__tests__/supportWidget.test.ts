import { describe, expect, it } from 'vitest'
import { acceptFiles, imagesFromTransfer } from '../SupportWidget'

function png(name: string, size = 1024): File {
  const f = new File([new Uint8Array(8)], name, { type: 'image/png' })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

/** DataTransfer в jsdom не конструируется — подсовываем то же, что читает код. */
function transfer(items: Array<{ kind: string; file?: File }>): DataTransfer {
  return {
    items: items.map(i => ({ kind: i.kind, getAsFile: () => i.file ?? null })),
    files: [],
    getData: () => '',
  } as unknown as DataTransfer
}

describe('acceptFiles — одна проверка на три входа', () => {
  it('пропускает картинки в пределах лимита', () => {
    const { files, error } = acceptFiles([], [png('a.png'), png('b.png')])
    expect(files).toHaveLength(2)
    expect(error).toBeNull()
  })

  it('добавляет к уже выбранным, а не заменяет их', () => {
    const { files } = acceptFiles([png('a.png')], [png('b.png')])
    expect(files.map(f => f.name)).toEqual(['a.png', 'b.png'])
  })

  it('упирается в пять файлов и объясняет почему', () => {
    const current = [png('1.png'), png('2.png'), png('3.png'), png('4.png'), png('5.png')]
    const { files, error } = acceptFiles(current, [png('6.png')])
    expect(files).toHaveLength(5)
    expect(error).toContain('Не больше 5')
  })

  it('отбивает не-картинку, но берёт остальные из той же пачки', () => {
    const pdf = new File([new Uint8Array(4)], 'doc.pdf', { type: 'application/pdf' })
    const { files, error } = acceptFiles([], [pdf, png('ok.png')])
    expect(files.map(f => f.name)).toEqual(['ok.png'])
    expect(error).toContain('Только изображения')
  })

  it('отбивает файл больше 5 МБ', () => {
    const { files, error } = acceptFiles([], [png('big.png', 6 * 1024 * 1024)])
    expect(files).toHaveLength(0)
    expect(error).toContain('5 МБ')
  })

  it('показывает одну причину, а не список', () => {
    const pdf = new File([new Uint8Array(4)], 'doc.pdf', { type: 'application/pdf' })
    const { error } = acceptFiles([], [pdf, png('big.png', 6 * 1024 * 1024)])
    expect(error).toContain('Только изображения')
  })
})

describe('imagesFromTransfer — буфер и перетаскивание', () => {
  it('даёт безымянному скриншоту человеческое имя', () => {
    const files = imagesFromTransfer(transfer([{ kind: 'file', file: png('') }]))
    expect(files[0].name).toBe('скриншот-1.png')
    expect(files[0].type).toBe('image/png')
  })

  it('переименовывает и типовое image.png из буфера', () => {
    const files = imagesFromTransfer(transfer([{ kind: 'file', file: png('image.png') }]))
    expect(files[0].name).toBe('скриншот-1.png')
  })

  it('продолжает нумерацию от уже приложенных', () => {
    const files = imagesFromTransfer(transfer([{ kind: 'file', file: png('') }]), 2)
    expect(files[0].name).toBe('скриншот-3.png')
  })

  it('осмысленное имя файла не трогает', () => {
    const files = imagesFromTransfer(transfer([{ kind: 'file', file: png('ошибка-рамки.png') }]))
    expect(files[0].name).toBe('ошибка-рамки.png')
  })

  it('текстовые элементы буфера пропускает', () => {
    const files = imagesFromTransfer(transfer([
      { kind: 'string' },
      { kind: 'file', file: png('') },
    ]))
    expect(files).toHaveLength(1)
  })

  it('пустой буфер — пустой список', () => {
    expect(imagesFromTransfer(null)).toEqual([])
    expect(imagesFromTransfer(transfer([]))).toEqual([])
  })
})
