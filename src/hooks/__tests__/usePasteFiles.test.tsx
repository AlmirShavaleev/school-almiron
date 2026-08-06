import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { usePasteFiles } from '@/hooks/usePasteFiles'

function png(name = 'image.png'): File {
  return new File([new Uint8Array(8)], name, { type: 'image/png' })
}

/** DataTransfer в jsdom не конструируется — подсовываем то, что читает код. */
function clipboard(files: File[]) {
  return {
    items: files.map(f => ({ kind: 'file', getAsFile: () => f })),
    files: [],
    getData: () => '',
  } as unknown as DataTransfer
}

function paste(files: File[] = [png()]) {
  const e = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(e, 'clipboardData', { value: clipboard(files) })
  act(() => { document.dispatchEvent(e) })
}

function Zone({ onFiles, startIndex = 0, enabled = true }: {
  onFiles: (files: File[]) => void
  startIndex?: number
  enabled?: boolean
}) {
  usePasteFiles(onFiles, enabled, startIndex)
  return <div>зона</div>
}

describe('usePasteFiles — сквозная нумерация скриншотов', () => {
  let got: string[]
  const onFiles = vi.fn((files: File[]) => { got.push(...files.map(f => f.name)) })

  beforeEach(() => {
    got = []
    onFiles.mockClear()
  })

  /**
   * Жалоба владельца (§99): вставил три скриншота подряд — все «скриншот-1».
   * Список вложений обновляется только после загрузки, поэтому один
   * `startIndex` извне тут не спасает: хук помнит выданное сам.
   */
  it('две вставки подряд дают разные имена', () => {
    render(<Zone onFiles={onFiles} />)

    paste()
    paste()

    expect(got).toEqual(['скриншот-1.png', 'скриншот-2.png'])
  })

  it('три вставки подряд — три разных имени', () => {
    render(<Zone onFiles={onFiles} />)

    paste()
    paste()
    paste()

    expect(new Set(got).size).toBe(3)
    expect(got[2]).toBe('скриншот-3.png')
  })

  it('вставка нескольких картинок разом нумеруется внутри себя', () => {
    render(<Zone onFiles={onFiles} />)

    paste([png(), png()])
    paste()

    expect(got).toEqual(['скриншот-1.png', 'скриншот-2.png', 'скриншот-3.png'])
  })

  it('продолжает с уже прикреплённых, а не с единицы', () => {
    // startIndex приходит из списка вложений темы: там уже есть скриншот-4.
    render(<Zone onFiles={onFiles} startIndex={4} />)

    paste()

    expect(got).toEqual(['скриншот-5.png'])
  })

  it('осмысленные имена не переименовывает и в счёт не берёт', () => {
    render(<Zone onFiles={onFiles} />)

    paste([png('конспект.png')])
    paste()

    expect(got).toEqual(['конспект.png', 'скриншот-1.png'])
  })

  it('выключенная зона вставку не берёт', () => {
    render(<Zone onFiles={onFiles} enabled={false} />)
    paste()
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('картинку забирает верхняя зона, и нумерация у неё своя', () => {
    const top: string[] = []
    render(
      <>
        <Zone onFiles={onFiles} />
        <Zone onFiles={files => top.push(...files.map(f => f.name))} startIndex={7} />
      </>,
    )

    paste()

    expect(top).toEqual(['скриншот-8.png'])
    expect(onFiles).not.toHaveBeenCalled()
  })
})
