import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'

/**
 * §139. Эталон рисуется своими страницами вместо встроенного просмотрщика
 * браузера. Тест держит то, ради чего это делалось: страницы идут подряд во
 * всю ширину панели, лишнего хрома нет, перерисовка при смене ширины —
 * настоящая (иначе страница мылится), а отказ движка не оставляет
 * преподавателя без решения.
 */

const renderCalls: Array<{ page: number; width: number; height: number }> = []
const cancel = vi.fn()
const destroy = vi.fn()

function fakePage(pageNumber: number) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 848 * scale }),
    render: ({ canvas, viewport }: any) => {
      renderCalls.push({ page: pageNumber, width: canvas.width, height: viewport.height })
      return { promise: Promise.resolve(), cancel }
    },
  }
}

const getDocument = vi.fn(() => ({
  promise: Promise.resolve({ numPages: 5, getPage: (n: number) => Promise.resolve(fakePage(n)), destroy }),
  destroy,
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: (...args: unknown[]) => getDocument(...(args as [])),
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }))

import SolutionPdfPages from '@/components/courseProgram/SolutionPdfPages'

/** ResizeObserver в jsdom нет; подменяем управляемым. */
let notify: ((width: number) => void) | null = null
class FakeResizeObserver {
  // Поле объявлено явно: сокращение `constructor(private cb)` запрещено
  // настройкой `erasableSyntaxOnly` в tsconfig.
  cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
    notify = (width: number) => {
      this.cb([{ contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
  }
  observe() {}
  disconnect() { notify = null }
}

describe('SolutionPdfPages', () => {
  beforeEach(() => {
    renderCalls.length = 0
    cancel.mockClear()
    destroy.mockClear()
    getDocument.mockClear()
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
    // Поддельные таймеры здесь не нужны: пауза перед перерисовкой 120 мс,
    // настоящий `waitFor` её пережидает, а вместе с `useFakeTimers` он
    // блокируется — таймеры крутит он сам.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 700 })
  })

  async function mount() {
    const view = render(<SolutionPdfPages url="signed://solution.pdf" name="solution.pdf" />)
    // Ширина применяется с паузой: ползунок §138 шлёт события пачками.
    await waitFor(() => expect(renderCalls.length).toBeGreaterThanOrEqual(5))
    return view
  }

  it('рисует все страницы подряд, а не первую', async () => {
    await mount()

    for (let page = 1; page <= 5; page += 1) {
      expect(screen.getByTestId(`solution-pdf-page-${page}`)).toBeInTheDocument()
    }
  })

  it('страница масштабируется под ширину панели и плотность экрана', async () => {
    await mount()

    // Ширина холста считается с devicePixelRatio: без множителя страница
    // мылится на ретине и после перетаскивания ползунка.
    const dpr = window.devicePixelRatio || 1
    expect(renderCalls[0].width).toBeCloseTo(700 * dpr, 0)
  })

  it('перетаскивание ползунка перерисовывает страницы, а не растягивает холст', async () => {
    await mount()
    const before = renderCalls.length

    await act(async () => { notify?.(900) })

    await waitFor(() => expect(renderCalls.length).toBeGreaterThan(before))
    const dpr = window.devicePixelRatio || 1
    expect(renderCalls[renderCalls.length - 1].width).toBeCloseTo(900 * dpr, 0)
  })

  it('пачка событий ширины даёт одну перерисовку, а не десяток', async () => {
    await mount()
    const before = renderCalls.length

    await act(async () => {
      for (const width of [710, 720, 730, 740, 750]) notify?.(width)
    })

    // Пять событий — пять страниц перерисованы по разу, а не 25 раз.
    await waitFor(() => expect(renderCalls.length).toBe(before + 5))
  })

  it('если движок не завёлся — говорит об этом, а не показывает пустоту', async () => {
    getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('worker failed')),
      destroy,
    }) as any)

    render(<SolutionPdfPages url="signed://solution.pdf" name="solution.pdf" />)

    expect(await screen.findByText(/Не удалось показать/)).toBeInTheDocument()
    expect(screen.queryByTestId('solution-pdf-pages')).not.toBeInTheDocument()
  })
})
