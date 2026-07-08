import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: (pageNumber: number) => Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale, pageNumber }),
        render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      }),
    }),
    destroy: () => Promise.resolve(),
  }),
}))

vi.mock('@/lib/storage', () => ({
  extractStoragePath: (p: string) => p,
  getSignedFileUrl: async () => 'blob://fake.pdf',
}))

let selectResult: { data: unknown; error: unknown } = { data: [], error: null }
let lastUpsert: any = null
const fromSpy = vi.fn()
const scrollIntoViewSpy = vi.fn()
const observedElements: Element[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

function makeAnnotationTable() {
  const readChain: any = { eq: () => readChain, then: (res: any) => Promise.resolve(selectResult).then(res) }
  return {
    select: () => readChain,
    upsert: (payload: any) => { lastUpsert = payload; return Promise.resolve({ error: null }) },
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }
}

import { SubmissionReviewer } from '@/components/SubmissionReviewer'

class ResizeObserverMock {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.callback = callback }
  observe(target: Element) {
    this.callback([{ target, contentRect: { width: 600, height: 900 } as DOMRectReadOnly } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  disconnect() {}
  unobserve() {}
}

class IntersectionObserverMock {
  callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) { this.callback = callback }
  observe(target: Element) {
    observedElements.push(target)
    const pageNumber = Number((target as HTMLElement).dataset.pageNumber ?? '1')
    this.callback([{
      target,
      isIntersecting: true,
      intersectionRatio: pageNumber === 1 ? 1 : 0.6,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      time: 0,
    } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  disconnect() {}
  unobserve() {}
}

Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const pageNumber = Number((this as HTMLElement).dataset.pageNumber ?? (this as HTMLElement).closest('[data-page-number]')?.getAttribute('data-page-number') ?? '1')
  const top = (pageNumber - 1) * 250
  return {
    x: 0, y: top, left: 0, top, width: 200, height: 280, right: 200, bottom: top + 280,
    toJSON() { return this },
  } as DOMRect
}
Element.prototype.setPointerCapture = vi.fn()
Element.prototype.scrollIntoView = scrollIntoViewSpy

async function renderReady(props: Partial<React.ComponentProps<typeof SubmissionReviewer>> = {}) {
  render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" {...props} />)
  await waitFor(() => expect(screen.getByText('Комментарии')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('review-overlay-1')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('review-overlay-2')).toBeInTheDocument())
}

function dragRegion(pageNumber: number, fromX: number, fromY: number, toX: number, toY: number) {
  const svg = screen.getByTestId(`review-overlay-${pageNumber}`)
  const pageTop = (pageNumber - 1) * 250
  fireEvent.pointerDown(svg, { clientX: fromX * 100, clientY: pageTop + fromY * 100, pointerId: 1 })
  fireEvent.pointerMove(svg, { clientX: toX * 100, clientY: pageTop + toY * 100, pointerId: 1 })
  fireEvent.pointerUp(svg, { clientX: toX * 100, clientY: pageTop + toY * 100, pointerId: 1 })
}

describe('SubmissionReviewer regions', () => {
  beforeEach(() => {
    selectResult = { data: [], error: null }
    lastUpsert = null
    observedElements.length = 0
    scrollIntoViewSpy.mockReset()
    fromSpy.mockReset()
    fromSpy.mockImplementation(() => makeAnnotationTable())
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a continuous page strip and keeps later pages in the DOM', async () => {
    await renderReady()

    expect(screen.getByTestId('review-page-1')).toBeInTheDocument()
    expect(screen.getByTestId('review-page-2')).toBeInTheDocument()
    expect(screen.getByTestId('review-canvas-1')).toBeInTheDocument()
    expect(screen.getByTestId('review-canvas-2')).toBeInTheDocument()
  })

  it('drag on the second page creates a region comment with page=2 and version 2 data', async () => {
    await renderReady()
    dragRegion(2, 0.1, 0.2, 0.4, 0.5)

    expect(await screen.findByText('Комментарий к области')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст комментария' }), { target: { value: 'Проверь решение' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(lastUpsert?.page).toBe(2), { timeout: 2500 })
    expect(lastUpsert.data.objects[0]).toMatchObject({
      type: 'region',
      text: 'Проверь решение',
      rect: { x: 0.05, y: 0.07142857142857142, w: 0.15000000000000002, h: 0.10714285714285715 },
    })
  })

  it('ignores click-sized selections and Escape cancels an open editor', async () => {
    await renderReady()
    dragRegion(1, 0.1, 0.1, 0.105, 0.4)
    expect(screen.queryByText('Комментарий к области')).not.toBeInTheDocument()

    dragRegion(1, 0.1, 0.1, 0.3, 0.3)
    const textarea = await screen.findByRole('textbox', { name: 'Текст комментария' })
    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(screen.queryByText('Комментарий к области')).not.toBeInTheDocument()
    expect(screen.getByText('Выделите область на работе, чтобы добавить комментарий')).toBeInTheDocument()
  })

  it('standard phrase inserts text, praise can save empty, and delete removes a region', async () => {
    await renderReady()
    dragRegion(1, 0.1, 0.1, 0.3, 0.3)

    fireEvent.click(await screen.findByRole('button', { name: /Вычислительная ошибка/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Проверь знаки' }))
    expect(screen.getByRole('textbox', { name: 'Текст комментария' })).toHaveValue('Проверь знаки')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByText('Проверь знаки')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Удалить комментарий' }))
    await waitFor(() => expect(screen.queryByText('Проверь знаки')).not.toBeInTheDocument())

    dragRegion(1, 0.2, 0.2, 0.4, 0.4)
    fireEvent.click(await screen.findByRole('button', { name: /Отлично/ }))
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  })

  it('read-only loads old data without version, shows legacy marks and blocks editing controls', async () => {
    selectResult = {
      data: [{
        page: 1,
        status: 'published',
        data: {
          objects: [
            { id: 'legacy-text', type: 'text', text: 'старый текст', x: 0.1, y: 0.1, color: '#dc2626', size: 0.028 },
            { id: 'region-old', type: 'region', rect: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, category: 'logic', text: 'Пропущен шаг' },
          ],
        },
      }],
      error: null,
    }
    await renderReady({ readOnly: true })

    expect(await screen.findByText('старый текст')).toBeInTheDocument()
    expect(screen.getByText('Пропущен шаг')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить комментарий' })).not.toBeInTheDocument()
  })

  it('the editor scrolls its own content and keeps the Save/Cancel footer outside the scroll area', async () => {
    const { container } = render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" />)
    await waitFor(() => expect(screen.getByText('Комментарии')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('review-overlay-1')).toBeInTheDocument())
    dragRegion(1, 0.1, 0.1, 0.3, 0.3)

    fireEvent.click(await screen.findByRole('button', { name: /Вычислительная ошибка/ }))

    const saveButton = screen.getByRole('button', { name: 'Сохранить' })
    const footer = saveButton.parentElement!
    expect(footer.className).toContain('shrink-0')

    const scrollArea = container.querySelector('.overflow-y-auto.overscroll-contain')
    expect(scrollArea).not.toBeNull()
    expect(scrollArea!.contains(footer)).toBe(false)
  })

  it('a wheel over the editor does not lose the open draft', async () => {
    const { container } = render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" />)
    await waitFor(() => expect(screen.getByText('Комментарии')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('review-overlay-1')).toBeInTheDocument())
    dragRegion(1, 0.1, 0.1, 0.3, 0.3)

    const scrollArea = container.querySelector('.overflow-y-auto.overscroll-contain')!
    fireEvent.wheel(scrollArea, { deltaY: 400 })

    expect(screen.getByText('Комментарий к области')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Текст комментария' })).toBeInTheDocument()
  })

  it('replaces the comment list with the editor while keeping the grading card at the end of the document flow', async () => {
    await renderReady({ footer: <div><span>Оценка</span><button type="button">Принять</button></div> })

    const scrollZone = screen.getByTestId('review-rail-scroll-zone')
    const footer = screen.getByTestId('review-document-footer')
    expect(scrollZone).toContainElement(screen.getByText('Комментарии'))
    expect(footer).toContainElement(screen.getByText('Оценка'))
    expect(scrollZone).not.toContainElement(screen.getByText('Оценка'))

    dragRegion(1, 0.1, 0.1, 0.3, 0.3)

    expect(await screen.findByText('Комментарий к области')).toBeInTheDocument()
    expect(screen.queryByText('Комментарии')).not.toBeInTheDocument()
    expect(scrollZone).toContainElement(screen.getByText('Комментарий к области'))
    expect(footer).toContainElement(screen.getByText('Оценка'))
  })

  it('does not render the grading card in read-only mode', async () => {
    await renderReady({ readOnly: true, footer: <div>Оценка</div> })

    expect(screen.queryByTestId('review-document-footer')).not.toBeInTheDocument()
  })

  it('clicking a page-2 comment scrolls the strip to that page', async () => {
    selectResult = {
      data: [{
        page: 2,
        status: 'draft',
        data: {
          version: 2,
          objects: [{ id: 'r2', type: 'region', rect: { x: 0.1, y: 0.2, w: 0.2, h: 0.2 }, category: 'logic', text: 'Пропущен шаг' }],
        },
      }],
      error: null,
    }
    await renderReady()

    fireEvent.click(screen.getByText('Пропущен шаг'))

    expect(scrollIntoViewSpy).toHaveBeenCalled()
    expect(scrollIntoViewSpy.mock.calls.at(-1)?.[0]).toMatchObject({ block: 'center', behavior: 'smooth' })
  })
})
