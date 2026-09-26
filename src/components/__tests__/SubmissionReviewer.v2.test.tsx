/**
 * §226. Экран проверки v2 внутри разбора: вкладки «Фото N» вместо счётчика
 * страниц, «Повернуть» для текущей страницы в тулбаре и рамки заданий,
 * окрашенные вердиктом и подписанные номером. Без новых пропов — всё как
 * было: ученик и «Пометки учителя» этого не получают.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn(), success: vi.fn(), saved: vi.fn() } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: () => Promise.resolve({
        rotate: 0,
        getViewport: () => ({ width: 595, height: 842 }),
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
  getSignedFileUrl: async (_bucket: string, path: string) => `signed://${path}`,
}))

type Rect = { x: number; y: number; w: number; h: number }

let annotationRows: unknown[] = []
/** Запись страницы: ровно то, что аннотатор кладёт в `annotation_sets`. */
type SavedRow = {
  file_path: string
  page: number
  data: { version: 2; rotation?: number; objects: { id: string; rect: Rect }[] }
}
/** Всё, что аннотатор записал в `annotation_sets` за прогон сцены. */
let saved: SavedRow[] = []
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const readChain = {
        eq: () => readChain,
        in: () => readChain,
        then: (res: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: annotationRows, error: null }).then(res),
      }
      return {
        select: () => readChain,
        upsert: (row: SavedRow) => { saved.push(row); return Promise.resolve({ error: null }) },
        update: () => ({ eq: () => ({ in: () => Promise.resolve({ error: null }) }) }),
      }
    },
  },
}))

vi.mock('@/lib/attemptMarks', () => ({
  EMPTY_MARK_COUNTS: { ai: 0, regions: 0 },
  countAttemptMarks: async () => ({ ai: 0, regions: 0 }),
  clearAttemptMarks: async () => ({ ai: 0, regions: 0 }),
  clearMarksPrompt: () => '',
  hasAnyMarks: () => false,
}))

import { SubmissionReviewer } from '@/components/SubmissionReviewer'
import type { ReviewTaskVerdict } from '@/lib/homeworkReviewTasks'
import { VERDICT_FRAME_COLOR } from '@/lib/reviewFrameLook'

const PHOTO = 'att-1/page-1.jpg'
const SECOND = 'att-1/page-2.jpg'

function page(filePath: string, marks: unknown[]) {
  return { page: 1, file_path: filePath, status: 'draft', data: { version: 2, objects: marks } }
}

const frame = (id: string, task: string | null, text = `замечание ${id}`) => ({
  id, type: 'region', category: 'error', text, task, rect: { x: 0.1, y: 0.3, w: 0.3, h: 0.1 },
})

function renderReviewer(extra: { pageTabs?: boolean; taskVerdicts?: Record<string, ReviewTaskVerdict> | null } = {}) {
  return render(
    <SubmissionReviewer
      attemptId="att-1"
      bucket="topic-homework-attempts"
      filePath={PHOTO}
      filePaths={[PHOTO, SECOND]}
      notesInTaskList
      {...extra}
    />,
  )
}

beforeEach(() => {
  annotationRows = []
  saved = []
})

describe('§226 — вкладки страниц', () => {
  it('вместо «1 / 2» — «Фото 1», «Фото 2»; первая выбрана', async () => {
    renderReviewer({ pageTabs: true })
    const first = await screen.findByTestId('review-page-tab-1')
    expect(first).toHaveTextContent('Фото 1')
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('review-page-tab-2')).toHaveAttribute('aria-selected', 'false')
  })

  it('вкладка переводит к своей странице', async () => {
    renderReviewer({ pageTabs: true })
    const second = await screen.findByTestId('review-page-tab-2')
    // Страницы прочитаны и размеры листов посчитаны — лента больше не
    // пересобирается (пересборка ставит текущей первую страницу, §211).
    await waitFor(() => expect(screen.getByTestId('review-rotate-current')).not.toBeDisabled())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
    const target = screen.getByTestId('review-page-2')
    target.scrollIntoView = vi.fn()
    fireEvent.click(second)
    expect(target.scrollIntoView).toHaveBeenCalled()
    expect(second).toHaveAttribute('aria-selected', 'true')
  })

  it('«Повернуть» в тулбаре поворачивает текущую страницу', async () => {
    renderReviewer({ pageTabs: true })
    const button = await screen.findByTestId('review-rotate-current')
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    await waitFor(() => expect(saved.some(row => row.file_path === PHOTO)).toBe(true))
    // Кнопка у каждой страницы по-прежнему на месте.
    expect(screen.getByTestId('review-rotate-2')).toBeInTheDocument()
  })

  it('без `pageTabs` тулбар прежний — вкладок нет', async () => {
    renderReviewer()
    await screen.findByTestId('review-rotate-1')
    expect(screen.queryByTestId('review-page-tabs')).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-rotate-current')).not.toBeInTheDocument()
  })
})

describe('§226 — рамки заданий', () => {
  it('цвет рамки — вердикт её задания, подпись — номер и текст', async () => {
    annotationRows = [page(PHOTO, [frame('f3', '3', 'не отобран −7π/6'), frame('f6', '6'), frame('old', null)])]
    renderReviewer({ taskVerdicts: { '3': 'partial', '6': 'unchecked' } })
    const f3 = await screen.findByTestId('region-f3')
    expect(f3.getAttribute('stroke')).toBe(VERDICT_FRAME_COLOR.partial)
    expect(f3.getAttribute('stroke-dasharray')).toBeNull()
    expect(screen.getByTestId('region-label-f3')).toHaveTextContent('3 · не отобран −7π/6')

    // «Не сверено» — пунктиром: форма, а не только цвет.
    const f6 = screen.getByTestId('region-f6')
    expect(f6.getAttribute('stroke')).toBe(VERDICT_FRAME_COLOR.unchecked)
    expect(f6.getAttribute('stroke-dasharray')).not.toBeNull()

    // Рамка без задания — по-старому, без подписи.
    expect(screen.queryByTestId('region-label-old')).not.toBeInTheDocument()
    expect(screen.getByTestId('region-old').getAttribute('stroke')).toBe('#dc2626')
  })

  it('без вердиктов рамки как раньше — ученик и «Пометки учителя» не меняются', async () => {
    annotationRows = [page(PHOTO, [frame('f3', '3')])]
    renderReviewer()
    const f3 = await screen.findByTestId('region-f3')
    expect(f3.getAttribute('stroke')).toBe('#dc2626')
    expect(screen.queryByTestId('region-label-f3')).not.toBeInTheDocument()
  })
})
