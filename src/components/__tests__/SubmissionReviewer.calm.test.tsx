/**
 * §248. Спокойный экран проверки — аннотатор. Над фото только номера страниц
 * и подсказка «рисуйте прямо на фото»; масштаб и поворот — плавающими
 * кнопками в углу; «Очистить пометки» уехала в меню экрана (ручка
 * `clearMarksRef`). Текущее задание выделено на фото, чужие рамки приглушены,
 * место находки ИИ — пунктиром; новая рамка сразу привязана к текущему
 * заданию. Без `calm` ничего из этого не появляется.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn(), success: vi.fn(), saved: vi.fn() } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }))

vi.mock('@/lib/storage', () => ({
  forgetSignedUrl: () => {},
  SIGNED_URL_TTL_S: 3600,
  SHORT_SIGNED_URL_TTL_S: 300,
  UPLOAD_CACHE_CONTROL_S: '31536000',
  extractStoragePath: (p: string) => p,
  getSignedFileUrl: async (_bucket: string, path: string) => `signed://${path}`,
}))

let annotationRows: unknown[] = []
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
        upsert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => ({ in: () => Promise.resolve({ error: null }) }) }),
      }
    },
  },
}))

vi.mock('@/lib/attemptMarks', () => ({
  EMPTY_MARK_COUNTS: { ai: 0, regions: 0 },
  // Числа для подтверждения считает база (§156): на работе две рамки.
  countAttemptMarks: async () => ({ ai: 0, regions: 2 }),
  clearAttemptMarks: async () => ({ ai: 0, regions: 2 }),
  clearMarksPrompt: () => 'Будут удалены пометки',
  hasAnyMarks: (counts: { ai: number; regions: number }) => counts.ai + counts.regions > 0,
}))

import { SubmissionReviewer, type GhostRegion } from '@/components/SubmissionReviewer'

const PHOTO = 'att-1/page-1.jpg'
const SECOND = 'att-1/page-2.jpg'

const frame = (id: string, task: string | null) => ({
  id, type: 'region', category: 'error', text: `замечание ${id}`, task, rect: { x: 0.1, y: 0.3, w: 0.3, h: 0.1 },
})

function renderCalm(extra: Record<string, unknown> = {}) {
  return render(
    <SubmissionReviewer
      attemptId="att-1"
      bucket="topic-homework-attempts"
      filePath={PHOTO}
      filePaths={[PHOTO, SECOND]}
      notesInTaskList
      pageTabs
      calm
      hideToolbarPublish
      taskVerdicts={{ '3': 'wrong', '6': 'correct', '5': 'unchecked' }}
      taskNumbers={['3', '5', '6']}
      {...extra}
    />,
  )
}

beforeEach(() => {
  annotationRows = [{ page: 1, file_path: PHOTO, status: 'draft', data: { version: 2, objects: [frame('f3', '3'), frame('f6', '6')] } }]
})

describe('§248 — над фото и на фото', () => {
  it('номера страниц вместо «Фото 1», подсказка про рамку, плавающие −/+/⟳', async () => {
    renderCalm()
    const first = await screen.findByTestId('review-page-tab-1')
    expect(first).toHaveTextContent(/^1$/)
    expect(first).toHaveAttribute('aria-label', 'Фото 1')
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('review-draw-hint')).toHaveTextContent('Рамку задания рисуйте мышью прямо на фото')

    const tools = screen.getByTestId('review-float-tools')
    expect(tools).toContainElement(screen.getByTitle('Уменьшить'))
    expect(tools).toContainElement(screen.getByTitle('Увеличить'))
    expect(tools).toContainElement(screen.getByTestId('review-rotate-current'))
    // Кнопок поворота у каждой страницы и «Очистить пометки» в тулбаре нет.
    expect(screen.queryByTestId('review-rotate-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('clear-marks-button')).not.toBeInTheDocument()
  })

  it('плюс увеличивает, нажатие на масштаб возвращает «по ширине»', async () => {
    renderCalm()
    await screen.findByTestId('review-float-tools')
    fireEvent.click(screen.getByTitle('Увеличить'))
    expect(screen.getByTestId('review-zoom-value')).toHaveTextContent('120%')
    expect(screen.getByTestId('review-fit-width')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByTestId('review-fit-width'))
    expect(screen.getByTestId('review-zoom-value')).toHaveTextContent('100%')
    expect(screen.getByTestId('review-fit-width')).toHaveAttribute('aria-pressed', 'true')
  })

  it('«Очистить пометки» — ручкой наружу: есть рамки — пункт доступен, нажатие открывает подтверждение', async () => {
    const clearMarksRef = { current: null as (() => void) | null }
    const onAvailable = vi.fn()
    renderCalm({ clearMarksRef, onClearMarksAvailableChange: onAvailable })
    await screen.findByTestId('region-f3')
    await waitFor(() => expect(onAvailable).toHaveBeenLastCalledWith(true))
    expect(typeof clearMarksRef.current).toBe('function')
    clearMarksRef.current?.()
    // Подтверждение — прежнее (§156), со своим текстом и кнопками.
    expect(await screen.findByTestId('clear-marks-dialog')).toHaveAttribute('data-review-keys', 'off')
  })

  it('без `calm` всё как было: тулбар с масштабом, поворот у страницы', async () => {
    renderCalm({ calm: false })
    await screen.findByTestId('review-rotate-1')
    expect(screen.queryByTestId('review-float-tools')).not.toBeInTheDocument()
    expect(screen.getByTestId('review-page-tab-1')).toHaveTextContent('Фото 1')
  })
})

describe('§248 — текущее задание на фото', () => {
  it('рамка текущего задания выделена, остальные приглушены', async () => {
    renderCalm({ focusTaskNo: '3' })
    const f3 = await screen.findByTestId('region-f3')
    expect(f3).toHaveAttribute('data-emphasis', 'current')
    expect(screen.getByTestId('region-f6')).toHaveAttribute('data-emphasis', 'dim')
    expect(screen.getByTestId('region-label-f3')).toHaveAttribute('data-current', 'true')
    expect(screen.getByTestId('region-label-f6')).not.toHaveAttribute('data-current')
  })

  it('место находки ИИ — пунктиром только у текущего задания', async () => {
    const ghosts: GhostRegion[] = [
      { id: 'g5', filePath: PHOTO, page: 1, rect: { x: 0.2, y: 0.6, w: 0.4, h: 0.1 }, task: '5' },
    ]
    const { rerender } = renderCalm({ focusTaskNo: '5', ghostRegions: ghosts })
    const ghost = await screen.findByTestId('ghost-region-g5')
    expect(ghost.getAttribute('stroke-dasharray')).not.toBeNull()
    expect(ghost.getAttribute('pointer-events')).toBe('none')
    expect(screen.getByTestId('ghost-label-g5')).toHaveTextContent('ИИ · №5')

    rerender(
      <SubmissionReviewer
        attemptId="att-1"
        bucket="topic-homework-attempts"
        filePath={PHOTO}
        filePaths={[PHOTO, SECOND]}
        notesInTaskList
        pageTabs
        calm
        hideToolbarPublish
        taskVerdicts={{ '3': 'wrong', '6': 'correct', '5': 'unchecked' }}
        taskNumbers={['3', '5', '6']}
        focusTaskNo="3"
        ghostRegions={ghosts}
      />,
    )
    expect(screen.queryByTestId('ghost-region-g5')).not.toBeInTheDocument()
  })

  it('§252 «посмотреть на фото»: подсвеченные находки видны при любом текущем задании, ярче обычных', async () => {
    const ghosts: GhostRegion[] = [
      { id: 'g5', filePath: PHOTO, page: 1, rect: { x: 0.2, y: 0.6, w: 0.4, h: 0.1 }, task: '5' },
      { id: 'g3', filePath: PHOTO, page: 1, rect: { x: 0.2, y: 0.1, w: 0.4, h: 0.1 }, task: '3' },
      { id: 'g6', filePath: PHOTO, page: 1, rect: { x: 0.2, y: 0.3, w: 0.4, h: 0.1 }, task: '6' },
    ]
    renderCalm({ focusTaskNo: '3', ghostRegions: ghosts, highlightGhostIds: ['g5'] })
    const highlighted = await screen.findByTestId('ghost-region-g5')
    expect(highlighted).toHaveAttribute('data-highlight', 'true')
    expect(screen.getByTestId('ghost-label-g5')).toHaveTextContent('ИИ · №5')
    // Находка текущего задания — как раньше, без подсветки; чужая и не подсвеченная — не видна.
    expect(screen.getByTestId('ghost-region-g3')).not.toHaveAttribute('data-highlight')
    expect(screen.queryByTestId('ghost-region-g6')).not.toBeInTheDocument()
  })

  it('рамку рисуют прямо на фото — она сразу к текущему заданию', async () => {
    renderCalm({ focusTaskNo: '5' })
    await screen.findByTestId('region-f3')
    const overlay = screen.getByTestId('review-overlay-1') as unknown as SVGSVGElement
    overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect
    ;(overlay as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {}
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(overlay, { clientX: 50, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(overlay, { clientX: 50, clientY: 50, pointerId: 1 })

    const editor = await screen.findByTestId('comment-editor')
    expect(editor).toHaveTextContent('Замечание к заданию 5')
    expect(screen.getByTestId('comment-task-select')).toHaveValue('5')
  })
})
