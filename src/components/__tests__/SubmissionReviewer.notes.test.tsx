import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { error: toastError, success: toastSuccess } }))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: () => Promise.resolve({
        getViewport: () => ({ width: 100, height: 100 }),
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
  getSignedFileUrl: async () => 'blob://fake.jpg',
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

import {
  SubmissionReviewer,
  type AttemptNotesApi,
  type AttemptNotesSnapshot,
} from '@/components/SubmissionReviewer'

const FILE = 'att-1/scan.jpg'

const objects = () => (stored.find(r => r.file_path === FILE && r.page === 1)?.data?.objects ?? []) as any[]
const dismissed = () => (stored.find(r => r.file_path === FILE && r.page === 1)?.data?.dismissed ?? []) as string[]

function renderReviewer({ notesInTaskList = true }: { notesInTaskList?: boolean } = {}) {
  const api = { current: null as AttemptNotesApi | null }
  const snapshots: AttemptNotesSnapshot[] = []
  render(
    <SubmissionReviewer
      attemptId="att-1"
      bucket="topic-homework-attempts"
      filePath={FILE}
      notesInTaskList={notesInTaskList}
      notesApiRef={api}
      onNotesChange={snapshot => { snapshots.push(snapshot) }}
    />,
  )
  return { api, snapshots, last: () => snapshots[snapshots.length - 1] }
}

/** Жест «обвели область» поверх страницы: тот же путь, что у мыши. */
function drawRegion() {
  const overlay = screen.getByTestId('review-overlay-1') as unknown as SVGSVGElement
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
  ;(overlay as any).setPointerCapture = () => {}
  fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, pointerId: 1 })
  fireEvent.pointerMove(overlay, { clientX: 50, clientY: 50, pointerId: 1 })
  fireEvent.pointerUp(overlay, { clientX: 50, clientY: 50, pointerId: 1 })
}

/**
 * §209. Замечание — рамка на работе, привязанная к заданию.
 *
 * Здесь проверяется сама механика: «+ Заметка» включает рисование, рамка
 * сохраняется с номером задания, список замечаний уезжает наружу, а отдельной
 * колонки «Комментарии» на экране проверки нет.
 */
describe('SubmissionReviewer — замечания как рамки (§209)', () => {
  beforeEach(() => {
    stored = [{ page: 1, file_path: FILE, status: 'draft', author_id: 'teacher-1', data: { version: 2, objects: [] } }]
    toastError.mockReset()
  })

  it('колонки «Комментарии» на экране проверки нет', async () => {
    renderReviewer()
    await waitFor(() => expect(screen.getByTestId('review-overlay-1')).toBeInTheDocument())
    expect(screen.queryByTestId('comment-list')).not.toBeInTheDocument()
  })

  it('там, где таблицы заданий рядом нет, список остаётся', async () => {
    renderReviewer({ notesInTaskList: false })
    await waitFor(() => expect(screen.getByTestId('comment-list')).toBeInTheDocument())
  })

  it('«+ Заметка» → рамка → тип и текст → замечание с номером задания', async () => {
    const view = renderReviewer()
    await waitFor(() => expect(view.api.current).not.toBeNull())

    act(() => { view.api.current!.startNote('13') })
    expect(screen.getByTestId('note-draw-hint')).toHaveTextContent('заданию 13')

    act(() => { drawRegion() })
    // Выбор типа — из трёх, а не из пяти.
    expect(screen.getByTestId('comment-category-error')).toBeInTheDocument()
    expect(screen.getByTestId('comment-category-inaccuracy')).toBeInTheDocument()
    expect(screen.getByTestId('comment-category-good')).toBeInTheDocument()
    expect(screen.queryByTestId('comment-category-logic')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('comment-editor-text'), { target: { value: 'Ошибка в отборе корней' } })
    await act(async () => { fireEvent.click(screen.getByTestId('comment-editor-save')) })

    const region = objects().find(o => o.type === 'region')
    expect(region).toMatchObject({ task: '13', category: 'error', text: 'Ошибка в отборе корней' })
    expect(view.last().notes).toEqual([
      expect.objectContaining({ taskNo: '13', text: 'Ошибка в отборе корней', page: 1 }),
    ])
  })

  it('«взять» кладёт рамку находки как замечание задания, второй раз не удваивает', async () => {
    const view = renderReviewer()
    await waitFor(() => expect(view.api.current).not.toBeNull())
    const region = {
      filePath: FILE,
      page: 1,
      rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
      category: 'calc' as const,
      text: 'ошибка в отборе корней',
      sourceId: 'f1',
      jobId: 'job-1',
      task: '13',
    }
    await act(async () => { await view.api.current!.takeFinding(region) })
    await act(async () => { await view.api.current!.takeFinding(region) })
    expect(objects().filter(o => o.type === 'region')).toHaveLength(1)
    expect(objects()[0]).toMatchObject({ task: '13', source: { kind: 'ai', finding: 'f1' } })
  })

  it('«мимо» запоминается в тех же пометках — миграции не нужно', async () => {
    const view = renderReviewer()
    await waitFor(() => expect(view.api.current).not.toBeNull())
    await act(async () => {
      await view.api.current!.dismissFinding({ findingId: 'f7', filePath: FILE, page: 1 })
    })
    expect(dismissed()).toEqual(['f7'])
    expect(view.last().dismissedFindings).toEqual(['f7'])
  })

  it('отказ переживает правку рамок: страница пишется целиком, но не теряет его', async () => {
    const view = renderReviewer()
    await waitFor(() => expect(view.api.current).not.toBeNull())
    await act(async () => {
      await view.api.current!.dismissFinding({ findingId: 'f7', filePath: FILE, page: 1 })
    })
    await act(async () => {
      await view.api.current!.takeFinding({
        filePath: FILE,
        page: 1,
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
        category: 'calc',
        text: 'Знак',
        sourceId: 'f1',
        task: '13',
      })
    })
    expect(dismissed()).toEqual(['f7'])
  })

  it('удаление замечания убирает рамку, правка текста её не двигает', async () => {
    const view = renderReviewer()
    await waitFor(() => expect(view.api.current).not.toBeNull())
    await act(async () => {
      await view.api.current!.takeFinding({
        filePath: FILE,
        page: 1,
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
        category: 'calc',
        text: 'Знак',
        sourceId: 'f1',
        task: '13',
      })
    })
    const id = objects()[0].id
    await act(async () => { await view.api.current!.updateNote(id, 'Знак ускорения') })
    expect(objects()[0]).toMatchObject({ text: 'Знак ускорения', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } })
    await act(async () => { await view.api.current!.deleteNote(id) })
    expect(objects()).toHaveLength(0)
  })
})
