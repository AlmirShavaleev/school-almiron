import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

/**
 * §239. Учитель: у свободной рамки — маленький выбор «к заданию №» из строк
 * таблицы этой попытки. Выбор пишется в то же поле `task`, что «+ Заметка»
 * (§209): по нему ученик увидит замечание под заданием, а не в «Общих».
 *
 * И второе: разбор открывается сразу на нужной странице, когда ученик пришёл
 * из разбора с вырезки задания или миниатюры страницы.
 */

vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: new Promise(() => {}), destroy: () => Promise.resolve() }) }))
vi.mock('@/lib/storage', () => ({
  forgetSignedUrl: () => {},
  SIGNED_URL_TTL_S: 3600,
  SHORT_SIGNED_URL_TTL_S: 300,
  UPLOAD_CACHE_CONTROL_S: '31536000',
  extractStoragePath: (p: string) => p,
  getSignedFileUrl: async (_b: string, p: string) => `blob://${p}`,
}))

type Row = { page: number; file_path: string; status: string; author_id: string | null; data: any }
let stored: Row[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const readChain: any = {
        eq: () => readChain,
        in: () => readChain,
        then: (res: any) => Promise.resolve({ data: stored, error: null }).then(res),
      }
      return {
        select: () => readChain,
        update: () => readChain,
        upsert: (row: Row) => {
          const at = stored.findIndex(r => r.file_path === row.file_path && r.page === row.page)
          const next = { ...row, status: 'draft', author_id: 'teacher-1' }
          if (at >= 0) stored[at] = next
          else stored.push(next)
          return Promise.resolve({ error: null })
        },
      }
    },
    rpc: () => Promise.resolve({ data: [{ ai_findings: 0, teacher_regions: 0 }], error: null }),
  },
}))

import { SubmissionReviewer } from '@/components/SubmissionReviewer'

const FILE = 'att-1/scan.jpg'
const objects = () => (stored.find(r => r.file_path === FILE && r.page === 1)?.data?.objects ?? []) as any[]

function drawRegion() {
  const overlay = screen.getByTestId('review-overlay-1') as unknown as SVGSVGElement
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  ;(overlay as any).setPointerCapture = () => {}
  fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, pointerId: 1 })
  fireEvent.pointerMove(overlay, { clientX: 50, clientY: 50, pointerId: 1 })
  fireEvent.pointerUp(overlay, { clientX: 50, clientY: 50, pointerId: 1 })
}

describe('SubmissionReviewer — «к заданию №» у свободной рамки (§239)', () => {
  beforeEach(() => {
    stored = [{ page: 1, file_path: FILE, status: 'draft', author_id: 'teacher-1', data: { version: 2, objects: [] } }]
  })

  it('выбор из строк таблицы: выбранный номер ложится в поле task рамки', async () => {
    render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath={FILE} notesInTaskList taskNumbers={['1', '3', '7']} />)
    await waitFor(() => expect(screen.getByTestId('review-overlay-1')).toBeInTheDocument())
    act(() => { drawRegion() })

    const select = screen.getByTestId('comment-task-select') as HTMLSelectElement
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['—', '№1', '№3', '№7'])
    expect(select.value).toBe('')
    fireEvent.change(select, { target: { value: '7' } })
    expect(screen.getByTestId('comment-editor')).toHaveTextContent('Замечание к заданию 7')

    fireEvent.click(screen.getByTestId('comment-category-error'))
    fireEvent.change(screen.getByTestId('comment-editor-text'), { target: { value: 'Нет графика v(t)' } })
    await act(async () => { fireEvent.click(screen.getByTestId('comment-editor-save')) })

    expect(objects().find(o => o.type === 'region')).toMatchObject({ task: '7', text: 'Нет графика v(t)' })
  })

  it('«—» оставляет рамку без задания', async () => {
    render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath={FILE} notesInTaskList taskNumbers={['1', '3']} />)
    await waitFor(() => expect(screen.getByTestId('review-overlay-1')).toBeInTheDocument())
    act(() => { drawRegion() })
    fireEvent.change(screen.getByTestId('comment-task-select'), { target: { value: '3' } })
    fireEvent.change(screen.getByTestId('comment-task-select'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('comment-category-error'))
    fireEvent.change(screen.getByTestId('comment-editor-text'), { target: { value: 'Общее' } })
    await act(async () => { fireEvent.click(screen.getByTestId('comment-editor-save')) })
    expect(objects().find(o => o.type === 'region')).not.toHaveProperty('task')
  })

  it('в модалке «Указать ошибки рамками» (колонка комментариев) выбор тот же', async () => {
    render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath={FILE} taskNumbers={['2']} />)
    await waitFor(() => expect(screen.getByTestId('review-overlay-1')).toBeInTheDocument())
    act(() => { drawRegion() })
    fireEvent.change(screen.getByTestId('comment-task-select'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('comment-editor-text'), { target: { value: 'Проверь знак' } })
    await act(async () => { fireEvent.click(screen.getByTestId('comment-editor-save')) })
    expect(objects().find(o => o.type === 'region')).toMatchObject({ task: '2', text: 'Проверь знак' })
  })

  it('таблицы нет — выбора нет', async () => {
    render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath={FILE} notesInTaskList taskNumbers={[]} />)
    await waitFor(() => expect(screen.getByTestId('review-overlay-1')).toBeInTheDocument())
    act(() => { drawRegion() })
    expect(screen.getByTestId('comment-editor')).toBeInTheDocument()
    expect(screen.queryByTestId('comment-task-select')).not.toBeInTheDocument()
  })
})

describe('SubmissionReviewer — открыть сразу на нужной странице (§239)', () => {
  const FILES = ['att-1/p1.jpg', 'att-1/p2.jpg', 'att-1/p3.jpg']

  beforeEach(() => {
    stored = [{
      page: 1, file_path: FILES[2], status: 'published', author_id: 'teacher-1',
      data: { version: 2, objects: [{ id: 'far', type: 'region', category: 'error', text: 'Здесь', rect: { x: 0.1, y: 0.8, w: 0.3, h: 0.1 } }] },
    }]
  })

  /** Фото «загрузились» — до этого высоты страниц неизвестны, и прокрутка ждёт. */
  async function loadImages() {
    await waitFor(() => expect(screen.getAllByAltText('Работа ученика')).toHaveLength(3))
    for (const img of screen.getAllByAltText('Работа ученика')) {
      Object.defineProperty(img, 'naturalWidth', { value: 1200, configurable: true })
      Object.defineProperty(img, 'naturalHeight', { value: 1600, configurable: true })
      fireEvent.load(img)
    }
  }

  it('по номеру страницы: счётчик сразу на ней', async () => {
    render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath={FILES[0]} filePaths={FILES} readOnly initialPage={2} />)
    await loadImages()
    await waitFor(() => expect(screen.getByText('2 / 3')).toBeInTheDocument())
  })

  it('по рамке: её страница и подсветка рамки', async () => {
    render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath={FILES[0]} filePaths={FILES} readOnly initialPage={3} initialRegionId="far" />)
    await loadImages()
    await waitFor(() => expect(screen.getByText('3 / 3')).toBeInTheDocument())
    // Активная рамка рисуется толще (как при нажатии на комментарий).
    await waitFor(() => expect(screen.getByTestId('region-far')).toHaveAttribute('stroke-width', '0.005'))
  })

  it('без начальной страницы — как раньше, с первой', async () => {
    render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath={FILES[0]} filePaths={FILES} readOnly />)
    await loadImages()
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument())
  })
})
