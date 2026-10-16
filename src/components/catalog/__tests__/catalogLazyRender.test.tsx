/**
 * Каталог быстрее: рисунки задач грузятся по мере прокрутки, формулы KaTeX
 * рисуются только у карточек на экране, общий наблюдатель их не трогает.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const upgradeMathIn = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/katexLoader', () => ({ upgradeMathIn }))

import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { resolveTaskHtml as resolveInContent } from '../CatalogTaskContent'
import { TaskContentRenderer } from '../TaskContentRenderer'
import { LAZY_MATH_SELECTOR, upgradeCatalogMath } from '@/lib/catalogMarkdown'

const asset = { id: 'a', tex_session_id: null, kind: 'condition', storage_path: 'x/fig.png', alt: null, position: 1 }

describe('рисунки — lazy', () => {
  it('обе копии resolveTaskHtml ставят loading="lazy" decoding="async", санитайзер их оставляет', () => {
    for (const fn of [resolveTaskHtml, resolveInContent]) {
      const html = fn('<p>a<img src="fig.png"> b <img src="https://cdn/x.png" loading="eager"></p>', [asset])
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const [own, ext] = Array.from(doc.querySelectorAll('img'))
      expect(own.getAttribute('loading')).toBe('lazy')
      expect(own.getAttribute('decoding')).toBe('async')
      expect(own.getAttribute('src')).toMatch(/x\/fig\.png/)
      expect(ext.getAttribute('loading')).toBe('eager')   // заданное автором не трогаем
    }
  })
})

describe('KaTeX — только на экране', () => {
  let observed: Array<{ cb: IntersectionObserverCallback; disconnect: ReturnType<typeof vi.fn> }>
  beforeEach(() => {
    observed = []
    upgradeMathIn.mockClear()
    vi.stubGlobal('IntersectionObserver', class {
      disconnect = vi.fn()
      constructor(cb: IntersectionObserverCallback) { observed.push({ cb, disconnect: this.disconnect }) }
      observe() {}
      unobserve() {}
      takeRecords() { return [] }
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  const html = '<p><span class="catalog-math-pending">x^2</span></p>'

  it('карточка вне экрана — KaTeX не грузится; появилась — дорисовывает один раз', () => {
    const { container } = render(<TaskContentRenderer html={html} />)
    expect(container.querySelector(LAZY_MATH_SELECTOR)).not.toBeNull()
    expect(upgradeMathIn).not.toHaveBeenCalled()
    const io = observed[0]
    io.cb([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(upgradeMathIn).not.toHaveBeenCalled()
    io.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    expect(upgradeMathIn).toHaveBeenCalledTimes(1)
    expect(io.disconnect).toHaveBeenCalled()
  })

  it('без формул — наблюдателя нет', () => {
    render(<TaskContentRenderer html="<p>просто текст</p>" />)
    expect(observed).toHaveLength(0)
  })

  it('общий наблюдатель (skipLazy) пропускает формулы карточек, остальные рисует', () => {
    const root = document.createElement('div')
    root.innerHTML = `<div data-math-lazy=""><span class="catalog-math-pending">a</span></div><span class="catalog-math-pending">b</span>`
    const katex = { renderToString: (tex: string) => `<b>${tex}</b>` }
    expect(upgradeCatalogMath(root, katex, { skipLazy: true })).toBe(1)
    expect(root.querySelectorAll('.catalog-math-pending')).toHaveLength(1)
    expect(upgradeCatalogMath(root, katex)).toBe(1)
  })
})
