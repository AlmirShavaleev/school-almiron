import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

/**
 * Regression coverage for the review-page layout fixes:
 * 1. fit-page scale is computed from the (mocked) real container size —
 *    locks in the height-bound-scale contract so a stale/zero measurement
 *    can't silently regress back to a tiny canvas.
 * 2. an open comment draft REPLACES the comment list in the rail (not
 *    alongside it).
 * 3. the footer (score/actions) is never a descendant of the rail's
 *    scroll zone — it can't be scrolled away or overlapped by long content.
 */

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

const BASE_W = 200
const BASE_H = 300

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: () => Promise.resolve({
        getViewport: ({ scale }: { scale: number }) => ({ width: BASE_W * scale, height: BASE_H * scale }),
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
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

function makeAnnotationTable() {
  const readChain: any = { eq: () => readChain, then: (res: any) => Promise.resolve({ data: [], error: null }).then(res) }
  return { select: () => readChain, upsert: () => Promise.resolve({ error: null }), update: () => ({ eq: () => Promise.resolve({ error: null }) }) }
}

// Container size the fit-page calc should read. contentRect (per spec)
// already excludes padding — set directly, no CSS/layout engine needed.
let mockRect = { width: 1000, height: 500 }

class MockResizeObserver {
  cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.cb = cb }
  observe() { this.cb([{ contentRect: mockRect } as ResizeObserverEntry], this as unknown as ResizeObserver) }
  unobserve() {}
  disconnect() {}
}
;(globalThis as any).ResizeObserver = MockResizeObserver

import { SubmissionReviewer } from '@/components/SubmissionReviewer'

Element.prototype.setPointerCapture = vi.fn()
// jsdom never computes real layout — every element's own rect defaults to
// all-zero, which would make position()'s (clientX-rect.left)/rect.width
// divide by zero. The drag-to-open-draft tests below need a non-zero box.
Element.prototype.getBoundingClientRect = () => ({
  x: 0, y: 0, left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100,
  toJSON() { return this },
}) as DOMRect

describe('SubmissionReviewer — fit-page scale reads the real container size', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    fromSpy.mockImplementation(() => makeAnnotationTable())
  })

  it('height-bound container: canvas matches min(widthScale, heightScale) computed from the observed size, not a stale/zero guess', async () => {
    mockRect = { width: 1000, height: 500 } // heightScale=(500-2)/300 binds vs widthScale=(1000-2)/200
    render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" fitPage />)

    await waitFor(() => expect(document.querySelector('svg[viewBox="0 0 1 1"]')).toBeInTheDocument())
    const canvas = await waitFor(() => {
      const el = document.querySelector('canvas') as HTMLCanvasElement
      expect(el.style.width).not.toBe('')
      return el
    })

    const heightScale = (500 - 2) / BASE_H
    const widthScale = (1000 - 2) / BASE_W
    const fittedScale = Math.min(widthScale, heightScale)
    expect(heightScale).toBeLessThan(widthScale) // sanity: this case is height-bound
    expect(parseFloat(canvas.style.width)).toBeCloseTo(BASE_W * fittedScale, 1)
    expect(parseFloat(canvas.style.height)).toBeCloseTo(BASE_H * fittedScale, 1)
  })

  it('width-bound container: a narrow/tall container binds on width instead', async () => {
    mockRect = { width: 150, height: 900 } // widthScale=(150-2)/200 binds vs heightScale=(900-2)/300
    render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" fitPage />)

    await waitFor(() => expect(document.querySelector('svg[viewBox="0 0 1 1"]')).toBeInTheDocument(), { timeout: 3000 })
    const canvas = await waitFor(() => {
      const el = document.querySelector('canvas') as HTMLCanvasElement
      expect(el.style.width).not.toBe('')
      return el
    })

    const heightScale = (900 - 2) / BASE_H
    const widthScale = (150 - 2) / BASE_W
    const fittedScale = Math.min(widthScale, heightScale)
    expect(widthScale).toBeLessThan(heightScale) // sanity: this case is width-bound
    expect(parseFloat(canvas.style.width)).toBeCloseTo(BASE_W * fittedScale, 1)
  })
})

describe('SubmissionReviewer — rail: draft replaces the list, footer stays outside scroll', () => {
  beforeEach(() => {
    mockRect = { width: 1000, height: 500 }
    fromSpy.mockReset()
    fromSpy.mockImplementation(() => makeAnnotationTable())
  })

  function svgOverlay() {
    return document.querySelector('svg[viewBox="0 0 1 1"]') as SVGSVGElement
  }

  it('an open draft removes the comment list from the DOM entirely (replace, not stack)', async () => {
    render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" fitPage />)
    await waitFor(() => expect(screen.getByText('Комментарии')).toBeInTheDocument())
    await waitFor(() => expect(svgOverlay()).toBeInTheDocument())

    const svg = svgOverlay()
    fireEvent.pointerDown(svg, { clientX: 20, clientY: 20, pointerId: 1 })
    fireEvent.pointerMove(svg, { clientX: 80, clientY: 80, pointerId: 1 })
    fireEvent.pointerUp(svg, { clientX: 80, clientY: 80, pointerId: 1 })

    expect(await screen.findByText('Комментарий к области')).toBeInTheDocument()
    // The list header/empty-state and "Комментарии" count badge must be gone
    // — the editor REPLACES it in the same slot, not alongside it.
    expect(screen.queryByText('Комментарии')).not.toBeInTheDocument()
    expect(screen.queryByText('Выделите область на работе, чтобы добавить комментарий')).not.toBeInTheDocument()
  })

  it('footer content is rendered outside the rail scroll zone, never a descendant of it', async () => {
    const { container } = render(
      <SubmissionReviewer
        submissionId="sub-1" filePath="submissions/x/y.pdf" fitPage
        footer={<button data-testid="score-block">Оценка</button>}
      />,
    )
    await waitFor(() => expect(screen.getByTestId('score-block')).toBeInTheDocument())

    const scrollZone = container.querySelector('[data-testid="review-rail-scroll-zone"]')!
    const footer = screen.getByTestId('score-block')
    expect(scrollZone.contains(footer)).toBe(false)

    // ...and stays out even once a draft is open and the rail's top slot
    // is showing the (potentially tall) CommentEditor instead of the list.
    await waitFor(() => expect(svgOverlay()).toBeInTheDocument())
    const svg = svgOverlay()
    fireEvent.pointerDown(svg, { clientX: 20, clientY: 20, pointerId: 1 })
    fireEvent.pointerMove(svg, { clientX: 80, clientY: 80, pointerId: 1 })
    fireEvent.pointerUp(svg, { clientX: 80, clientY: 80, pointerId: 1 })
    await screen.findByText('Комментарий к области')
    expect(scrollZone.contains(screen.getByTestId('score-block'))).toBe(false)
  })
})
