import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: () => Promise.resolve({
        getViewport: () => ({ width: 100, height: 100 }),
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

Element.prototype.getBoundingClientRect = () => ({
  x: 0, y: 0, left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200,
  toJSON() { return this },
}) as DOMRect
Element.prototype.setPointerCapture = vi.fn()

async function renderReady(props: Partial<React.ComponentProps<typeof SubmissionReviewer>> = {}) {
  render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" {...props} />)
  await waitFor(() => expect(screen.getByText('Комментарии')).toBeInTheDocument())
  await waitFor(() => expect(svgOverlay()).toBeInTheDocument())
}

function svgOverlay() {
  return document.querySelector('svg[viewBox="0 0 1 1"]') as SVGSVGElement
}

function dragRegion(fromX: number, fromY: number, toX: number, toY: number) {
  const svg = svgOverlay()
  fireEvent.pointerDown(svg, { clientX: fromX * 200, clientY: fromY * 200, pointerId: 1 })
  fireEvent.pointerMove(svg, { clientX: toX * 200, clientY: toY * 200, pointerId: 1 })
  fireEvent.pointerUp(svg, { clientX: toX * 200, clientY: toY * 200, pointerId: 1 })
}

describe('SubmissionReviewer regions', () => {
  beforeEach(() => {
    selectResult = { data: [], error: null }
    lastUpsert = null
    fromSpy.mockReset()
    fromSpy.mockImplementation(() => makeAnnotationTable())
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
  })

  it('drag creates a region comment with normalized rect and version 2 data', async () => {
    await renderReady()
    dragRegion(0.1, 0.2, 0.4, 0.5)

    expect(await screen.findByText('Комментарий к области')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Текст комментария' }), { target: { value: 'Проверь решение' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(screen.getByText('Проверь решение')).toBeInTheDocument())
    await waitFor(() => expect(lastUpsert?.data?.version).toBe(2), { timeout: 2500 })
    expect(lastUpsert.data.objects[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      type: 'region',
      category: 'comment',
      text: 'Проверь решение',
      rect: { x: 0.1, y: 0.2, w: 0.30000000000000004, h: 0.3 },
    })
  })

  it('ignores click-sized selections and Escape cancels an open editor', async () => {
    await renderReady()
    dragRegion(0.1, 0.1, 0.105, 0.4)
    expect(screen.queryByText('Комментарий к области')).not.toBeInTheDocument()

    dragRegion(0.1, 0.1, 0.3, 0.3)
    const textarea = await screen.findByRole('textbox', { name: 'Текст комментария' })
    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(screen.queryByText('Комментарий к области')).not.toBeInTheDocument()
    expect(screen.getByText('Выделите область на работе, чтобы добавить комментарий')).toBeInTheDocument()
  })

  it('standard phrase inserts text, praise can save empty, and delete removes a region', async () => {
    await renderReady()
    dragRegion(0.1, 0.1, 0.3, 0.3)

    fireEvent.click(await screen.findByRole('button', { name: /Вычислительная ошибка/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Проверь знаки' }))
    expect(screen.getByRole('textbox', { name: 'Текст комментария' })).toHaveValue('Проверь знаки')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByText('Проверь знаки')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Удалить комментарий' }))
    await waitFor(() => expect(screen.queryByText('Проверь знаки')).not.toBeInTheDocument())

    dragRegion(0.2, 0.2, 0.4, 0.4)
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
    expect(screen.queryByText('Выделите область мышкой')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить комментарий' })).not.toBeInTheDocument()
  })

  it('the editor scrolls its own content and keeps the Save/Cancel footer outside the scroll area', async () => {
    const { container } = render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" />)
    await waitFor(() => expect(screen.getByText('Комментарии')).toBeInTheDocument())
    await waitFor(() => expect(svgOverlay()).toBeInTheDocument())
    dragRegion(0.1, 0.1, 0.3, 0.3)

    // Pick a category with phrases so the editor is at its tallest.
    fireEvent.click(await screen.findByRole('button', { name: /Вычислительная ошибка/ }))

    const saveButton = screen.getByRole('button', { name: 'Сохранить' })
    const footer = saveButton.parentElement!
    expect(footer.className).toContain('shrink-0')

    const scrollArea = container.querySelector('.overflow-y-auto.overscroll-contain')
    expect(scrollArea).not.toBeNull()
    expect(scrollArea).not.toBe(footer)
    // Footer must not be a descendant of the scroll area — it has to stay
    // pinned outside it, not scroll away with the category grid/phrases.
    expect(scrollArea!.contains(footer)).toBe(false)
  })

  it('a wheel over the editor does not lose the open draft (scroll stays local, no accidental close/reset)', async () => {
    const { container } = render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" />)
    await waitFor(() => expect(screen.getByText('Комментарии')).toBeInTheDocument())
    await waitFor(() => expect(svgOverlay()).toBeInTheDocument())
    dragRegion(0.1, 0.1, 0.3, 0.3)

    const scrollArea = container.querySelector('.overflow-y-auto.overscroll-contain')!
    fireEvent.wheel(scrollArea, { deltaY: 400 })

    // Draft editor is still open and untouched — a wheel event never
    // triggers any cancel/save/state-reset path.
    expect(screen.getByText('Комментарий к области')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Текст комментария' })).toBeInTheDocument()
  })

  it('replaces the comment list with the editor while keeping the grading footer outside the scroll zone', async () => {
    await renderReady({ footer: <div><span>Оценка</span><button type="button">Принять</button></div> })

    const scrollZone = screen.getByTestId('review-rail-scroll-zone')
    const footer = screen.getByTestId('review-rail-footer')
    expect(scrollZone).toContainElement(screen.getByText('Комментарии'))
    expect(footer).toContainElement(screen.getByText('Оценка'))
    expect(scrollZone).not.toContainElement(screen.getByText('Оценка'))

    dragRegion(0.1, 0.1, 0.3, 0.3)

    expect(await screen.findByText('Комментарий к области')).toBeInTheDocument()
    expect(screen.queryByText('Комментарии')).not.toBeInTheDocument()
    expect(scrollZone).toContainElement(screen.getByText('Комментарий к области'))
    expect(footer).toContainElement(screen.getByText('Оценка'))
  })
})
