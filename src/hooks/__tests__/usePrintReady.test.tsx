import { act, renderHook } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { usePrintReady } from '@/hooks/usePrintReady'

function makeReadyImage(src: string, naturalWidth: number) {
  const img = document.createElement('img')
  img.src = src
  Object.defineProperty(img, 'complete', { configurable: true, get: () => true })
  Object.defineProperty(img, 'naturalWidth', { configurable: true, get: () => naturalWidth })
  return img
}

describe('usePrintReady', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('does not flip to timedOut after all images are already loaded', () => {
    const container = document.createElement('div')
    container.appendChild(makeReadyImage('https://example.com/a.png', 400))
    container.appendChild(makeReadyImage('https://example.com/b.png', 320))
    document.body.appendChild(container)

    const ref = { current: container }
    const { result } = renderHook(() => usePrintReady(ref, []))

    expect(result.current.ready).toBe(true)
    expect(result.current.loaded).toBe(2)
    expect(result.current.total).toBe(2)
    expect(result.current.timedOut).toBe(false)

    act(() => {
      vi.advanceTimersByTime(8000)
    })

    expect(result.current.ready).toBe(true)
    expect(result.current.timedOut).toBe(false)
  })
})
