import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

const BASE_W = 200
const BASE_H = 300

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: (pageNumber: number) => Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({ width: BASE_W * scale, height: BASE_H * scale, pageNumber }),
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

const fromSpy = vi.fn()
const scrollIntoViewSpy = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

function makeAnnotationTable() {
  const readChain: any = { eq: () => readChain, then: (res: any) => Promise.resolve({ data: [], error: null }).then(res) }
  return { select: () => readChain, upsert: () => Promise.resolve({ error: null }), update: () => ({ eq: () => Promise.resolve({ error: null }) }) }
}

let mockRect = { width: 1000, height: 500 }

class MockResizeObserver {
  cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.cb = cb }
  observe(target: Element) { this.cb([{ target, contentRect: mockRect as DOMRectReadOnly } as ResizeObserverEntry], this as unknown as ResizeObserver) }
  unobserve() {}
  disconnect() {}
}

class MockIntersectionObserver {
  cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) { this.cb = cb }
  observe(target: Element) {
    const pageNumber = Number((target as HTMLElement).dataset.pageNumber ?? '1')
    this.cb([{
      target,
      isIntersecting: true,
      intersectionRatio: pageNumber === 1 ? 1 : 0.6,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      time: 0,
    } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
  unobserve() {}
  disconnect() {}
}

import { SubmissionReviewer } from '@/components/SubmissionReviewer'

Element.prototype.setPointerCapture = vi.fn()
Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const pageNumber = Number((this as HTMLElement).dataset.pageNumber ?? (this as HTMLElement).closest('[data-page-number]')?.getAttribute('data-page-number') ?? '1')
  const top = (pageNumber - 1) * 250
  return {
    x: 0, y: top, left: 0, top, width: 100, height: 100, right: 100, bottom: top + 100,
    toJSON() { return this },
  } as DOMRect
}
Element.prototype.scrollIntoView = scrollIntoViewSpy

describe('SubmissionReviewer — continuous strip fit-width and rail invariants', () => {
  beforeEach(() => {
    mockRect = { width: 1000, height: 500 }
    fromSpy.mockReset()
    scrollIntoViewSpy.mockReset()
    fromSpy.mockImplementation(() => makeAnnotationTable())
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  it('fits each page to the real document column width', async () => {
    render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" />)

    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument())
    const canvas = await waitFor(() => {
      const node = screen.getByTestId('review-canvas-1') as HTMLCanvasElement
      expect(node.style.width).not.toBe('')
      return node
    })
    const expectedScale = (1000 - 2 - 2) / BASE_W
    expect(parseFloat(canvas.style.width)).toBeCloseTo(BASE_W * expectedScale, 1)
    expect(parseFloat(canvas.style.height)).toBeCloseTo(BASE_H * expectedScale, 1)
  })

  it('keeps all page shells in the strip and updates the indicator from the visible page', async () => {
    render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" />)

    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument())
    expect(screen.getByTestId('review-page-1')).toBeInTheDocument()
    expect(screen.getByTestId('review-page-2')).toBeInTheDocument()
    expect(screen.getByTestId('review-page-3')).toBeInTheDocument()
  })

  it('an open draft replaces the comment list in the rail', async () => {
    render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" />)
    const svg = await waitFor(() => screen.getByTestId('review-overlay-1'))

    fireEvent.pointerDown(svg, { clientX: 20, clientY: 20, pointerId: 1 })
    fireEvent.pointerMove(svg, { clientX: 80, clientY: 80, pointerId: 1 })
    fireEvent.pointerUp(svg, { clientX: 80, clientY: 80, pointerId: 1 })

    expect(await screen.findByText('Комментарий к области')).toBeInTheDocument()
    expect(screen.queryByText('Комментарии')).not.toBeInTheDocument()
    expect(screen.queryByText('Выделите область на работе, чтобы добавить комментарий')).not.toBeInTheDocument()
  })

  it('footer content moves to the end of the document flow instead of the rail', async () => {
    const { container } = render(
      <SubmissionReviewer
        submissionId="sub-1"
        filePath="submissions/x/y.pdf"
        footer={<button data-testid="score-block">Оценка</button>}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('score-block')).toBeInTheDocument())

    const scrollZone = container.querySelector('[data-testid="review-rail-scroll-zone"]')!
    expect(scrollZone.contains(screen.getByTestId('score-block'))).toBe(false)
    expect(screen.getByTestId('review-document-footer')).toContainElement(screen.getByTestId('score-block'))

    const svg = await waitFor(() => screen.getByTestId('review-overlay-1'))
    fireEvent.pointerDown(svg, { clientX: 20, clientY: 20, pointerId: 1 })
    fireEvent.pointerMove(svg, { clientX: 80, clientY: 80, pointerId: 1 })
    fireEvent.pointerUp(svg, { clientX: 80, clientY: 80, pointerId: 1 })

    await screen.findByText('Комментарий к области')
    expect(scrollZone.contains(screen.getByTestId('score-block'))).toBe(false)
    expect(screen.getByTestId('review-document-footer')).toContainElement(screen.getByTestId('score-block'))
  })
})
