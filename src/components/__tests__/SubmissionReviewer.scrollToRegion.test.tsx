/**
 * §184 (board/037). Клик по замечанию должен приводить к САМОЙ РАМКЕ.
 *
 * Геометрия здесь нарочно такая же, как на живом экране: страница работы вдвое
 * выше видимой области (1200 против 600). При такой пропорции прежнее
 * «поставить страницу по центру» физически не могло показать рамку у края —
 * центрирование показывает только среднюю половину листа. Поэтому проверки
 * ниже смотрят не на факт вызова, а на то, попала ли рамка в видимое окно.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: (pageNumber: number) => Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale, pageNumber }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      }),
    }),
    destroy: () => Promise.resolve(),
  }),
}))

vi.mock('@/lib/storage', () => ({
  forgetSignedUrl: () => {},
  SIGNED_URL_TTL_S: 3600,
  SHORT_SIGNED_URL_TTL_S: 300,
  UPLOAD_CACHE_CONTROL_S: '31536000',
  extractStoragePath: (p: string) => p,
  getSignedFileUrl: async () => 'blob://fake.pdf',
}))

vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PAGE_HEIGHT = 1200
const AREA_HEIGHT = 600
/** Рамка у нижнего края третьей страницы — ровно случай из карточки. */
const LOW_RECT = { x: 0.12, y: 0.86, w: 0.6, h: 0.07 }
/** Рамка на первой странице, тоже вне «центральной половины» листа. */
const TOP_RECT = { x: 0.1, y: 0.08, w: 0.5, h: 0.06 }

let selectResult: { data: unknown; error: unknown } = { data: [], error: null }
const fromSpy = vi.fn()
const scrollToSpy = vi.fn()
const scrollIntoViewSpy = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

function makeAnnotationTable() {
  const readChain: any = { eq: () => readChain, in: () => readChain, then: (res: any) => Promise.resolve(selectResult).then(res) }
  return {
    select: () => readChain,
    upsert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }
}

import { SubmissionReviewer } from '@/components/SubmissionReviewer'

class ResizeObserverMock {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.callback = callback }
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 600, height: AREA_HEIGHT } as DOMRectReadOnly } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  disconnect() {}
  unobserve() {}
}

/**
 * Видна только первая страница. Так третья остаётся заглушкой до тех пор, пока
 * `currentPage` не станет третьим, — и по появлению её холста видно, что
 * прокрутка случилась ПОСЛЕ смены страницы, а не вместо неё.
 */
class IntersectionObserverMock {
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) { this.callback = callback }
  observe(target: Element) {
    const pageNumber = Number((target as HTMLElement).dataset.pageNumber ?? '1')
    this.callback([{
      target,
      isIntersecting: pageNumber === 1,
      intersectionRatio: pageNumber === 1 ? 1 : 0,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      time: 0,
    } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  disconnect() {}
  unobserve() {}
}

function fakeRect(top: number, height: number): DOMRect {
  return {
    x: 0, y: top, left: 0, top, width: 500, height, right: 500, bottom: top + height,
    toJSON() { return this },
  } as DOMRect
}

Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const element = this as HTMLElement
  if (element.dataset?.testid === 'review-document-scroll-area') return fakeRect(0, AREA_HEIGHT)
  const raw = element.dataset?.pageNumber
    ?? element.closest?.('[data-page-number]')?.getAttribute('data-page-number')
    ?? '1'
  return fakeRect((Number(raw) - 1) * PAGE_HEIGHT, PAGE_HEIGHT)
}
Element.prototype.setPointerCapture = vi.fn()
Element.prototype.scrollTo = scrollToSpy as unknown as Element['scrollTo']
Element.prototype.scrollIntoView = scrollIntoViewSpy

/** Куда рамка попадёт после прокрутки, в координатах содержимого. */
function regionBand(pageNumber: number, rect: { y: number; h: number }) {
  const area = screen.getByTestId('review-document-scroll-area').getBoundingClientRect()
  const page = screen.getByTestId(`review-page-${pageNumber}`).getBoundingClientRect()
  return {
    top: page.top + rect.y * page.height - area.top,
    bottom: page.top + (rect.y + rect.h) * page.height - area.top,
    areaHeight: area.height,
    /** То, куда прокрутило бы прежнее `scrollIntoView({ block: 'center' })`. */
    pageCenterTop: page.top - area.top + (page.height - area.height) / 2,
  }
}

async function renderReady() {
  render(<SubmissionReviewer attemptId="attempt-1" bucket="topic-homework-attempts" filePath="submissions/x/y.pdf" />)
  await waitFor(() => expect(screen.getByText('Комментарии')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('review-page-3')).toBeInTheDocument())
}

describe('SubmissionReviewer: переход к замечанию', () => {
  beforeEach(() => {
    selectResult = {
      data: [
        { page: 1, status: 'draft', data: { version: 2, objects: [{ id: 'r-top', type: 'region', rect: TOP_RECT, category: 'format', text: 'Нет единиц измерения' }] } },
        { page: 3, status: 'draft', data: { version: 2, objects: [{ id: 'r-low', type: 'region', rect: LOW_RECT, category: 'calc', text: 'Знак ускорения' }] } },
      ],
      error: null,
    }
    scrollToSpy.mockReset()
    scrollToSpy.mockImplementation(() => {})
    scrollIntoViewSpy.mockReset()
    fromSpy.mockReset()
    fromSpy.mockImplementation(() => makeAnnotationTable())
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('клик по замечанию на третьей странице приводит к рамке, а не к центру страницы', async () => {
    await renderReady()
    // Пока смотрим на первую страницу, третья — заглушка.
    expect(screen.getByTestId('review-placeholder-3')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Знак ускорения'))

    await waitFor(() => expect(scrollToSpy).toHaveBeenCalled())
    const options = scrollToSpy.mock.calls.at(-1)?.[0] as { top: number; behavior: ScrollBehavior }
    const band = regionBand(3, LOW_RECT)

    // Рамка целиком в видимом окне после прокрутки…
    expect(options.top).toBeLessThan(band.top)
    expect(options.top + band.areaHeight).toBeGreaterThan(band.bottom)
    // …и не у самого верхнего края: над ней видно, к чему замечание.
    expect(band.top - options.top).toBeGreaterThanOrEqual(16)
    // Контроль: прежняя прокрутка «страница по центру» рамку бы не показала.
    expect(band.pageCenterTop + band.areaHeight).toBeLessThan(band.top)
  })

  it('прокрутка происходит после отрисовки нужной страницы, а не вместо неё', async () => {
    await renderReady()
    let renderedAtScroll: boolean | null = null
    scrollToSpy.mockImplementation(() => {
      renderedAtScroll = screen.queryByTestId('review-canvas-3') !== null
    })

    fireEvent.click(screen.getByText('Знак ускорения'))

    await waitFor(() => expect(scrollToSpy).toHaveBeenCalled())
    expect(renderedAtScroll).toBe(true)
    expect(scrollIntoViewSpy).not.toHaveBeenCalled()
  })

  it('клик по замечанию на текущей странице прокручивает к рамке плавно', async () => {
    await renderReady()

    fireEvent.click(screen.getByText('Нет единиц измерения'))

    await waitFor(() => expect(scrollToSpy).toHaveBeenCalled())
    const options = scrollToSpy.mock.calls.at(-1)?.[0] as { top: number; behavior: ScrollBehavior }
    const band = regionBand(1, TOP_RECT)
    expect(options.behavior).toBe('smooth')
    expect(options.top).toBeLessThan(band.top)
    expect(options.top + band.areaHeight).toBeGreaterThan(band.bottom)
    expect(options.top).toBeGreaterThanOrEqual(0)
  })

  it('повторный клик по тому же замечанию прокручивает туда же, а не перестаёт работать', async () => {
    await renderReady()

    fireEvent.click(screen.getByText('Знак ускорения'))
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalledTimes(1))
    const first = scrollToSpy.mock.calls.at(-1)?.[0] as { top: number }

    fireEvent.click(screen.getByText('Знак ускорения'))
    await waitFor(() => expect(scrollToSpy).toHaveBeenCalledTimes(2))
    expect((scrollToSpy.mock.calls.at(-1)?.[0] as { top: number }).top).toBe(first.top)
  })

  it('наведение мыши на комментарий только подсвечивает рамку и не двигает документ', async () => {
    await renderReady()
    const items = screen.getAllByTestId('comment-list-item')

    fireEvent.mouseEnter(items[1])

    expect(scrollToSpy).not.toHaveBeenCalled()
    expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    // Подсветка при этом включилась: у наведённого комментария активный фон.
    await waitFor(() => expect(items[1].className).toContain('ring-2'))
  })
})
