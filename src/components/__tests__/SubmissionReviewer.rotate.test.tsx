/**
 * §211. Поворот страницы работы (board/062).
 *
 * Самое дорогое здесь — не кнопка, а рамки. Пометки преподавателя лежат в
 * долях страницы; поворот, который их не учёл, разом уводит всю его работу, и
 * восстановить её нечем. Поэтому тесты проверяют не «кнопка нажалась», а что
 * именно уезжает в базу, что рисуется на странице и что попадает в
 * скачиваемый файл.
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

import { SubmissionReviewer, type AttemptNotesApi } from '@/components/SubmissionReviewer'
import type { AttemptExportSnapshot } from '@/lib/attemptPdfSource'

const PHOTO = 'att-1/page-1.jpg'
const SECOND = 'att-1/page-2.jpg'

type Rect = { x: number; y: number; w: number; h: number }
/** Рамка в левой верхней четверти: у неё все четыре числа разные. */
const RECT: Rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }

function region(id: string, rect = RECT) {
  return { id, type: 'region', rect, category: 'error', text: `замечание ${id}` }
}

function page(filePath: string, marks: unknown[], rotation?: number) {
  return {
    page: 1,
    file_path: filePath,
    status: 'draft',
    data: { version: 2, objects: marks, ...(rotation ? { rotation } : {}) },
  }
}

function renderReviewer(
  paths: string[],
  refs: {
    exportRef?: { current: (() => AttemptExportSnapshot) | null }
    notesApiRef?: { current: AttemptNotesApi | null }
  } = {},
) {
  return render(
    <SubmissionReviewer
      attemptId="att-1"
      bucket="topic-homework-attempts"
      filePath={paths[0]}
      filePaths={paths}
      exportSourceRef={refs.exportRef}
      notesApiRef={refs.notesApiRef}
      notesInTaskList
    />,
  )
}

/** Числа рамки так, как она сейчас нарисована на странице. */
function drawnRect(id: string) {
  const node = screen.getByTestId(`region-${id}`)
  return {
    x: node.getAttribute('x'),
    y: node.getAttribute('y'),
    w: node.getAttribute('width'),
    h: node.getAttribute('height'),
  }
}

/**
 * Пропорция коробки страницы числом: по ней видно, что лист лёг набок.
 * jsdom нормализует `aspect-ratio: 0.7` в строку «0.7 / 1» — разбираем обе
 * формы, иначе сравнение молча превратится в NaN.
 */
function pageAspect(globalPage: number) {
  const box = screen.getByTestId(`review-overlay-${globalPage}`).parentElement as HTMLElement
  const [width, height = '1'] = box.style.aspectRatio.split('/')
  return Number(width) / Number(height)
}

async function rotate(globalPage: number) {
  const before = saved.length
  fireEvent.click(screen.getByTestId(`review-rotate-${globalPage}`))
  await waitFor(() => expect(saved.length).toBeGreaterThan(before))
}

/** Последняя запись по этой странице. */
function lastSaveFor(filePath: string) {
  const row = [...saved].reverse().find(item => item.file_path === filePath)
  if (!row) throw new Error(`по ${filePath} ничего не сохранялось`)
  return row
}

beforeEach(() => {
  annotationRows = []
  saved = []
})

describe('§211 — поворот страницы', () => {
  it('кнопка поворота есть у КАЖДОЙ страницы', async () => {
    renderReviewer([PHOTO, SECOND])
    await screen.findByTestId('review-rotate-1')
    expect(screen.getByTestId('review-rotate-2')).toBeInTheDocument()
  })

  it('угол сохраняется рядом с пометками той же страницы', async () => {
    annotationRows = [page(PHOTO, [region('r1')])]
    renderReviewer([PHOTO])
    await screen.findByTestId('region-r1')

    await rotate(1)

    const row = lastSaveFor(PHOTO)
    expect(row.data.rotation).toBe(1)
    // Пометки на месте и НЕ переписаны: хранятся координаты исходной
    // страницы, поворачивается только то, что видно.
    expect(row.data.objects).toHaveLength(1)
    expect(row.data.objects[0].rect).toEqual(RECT)
  })

  it('рамка едет вместе со страницей', async () => {
    annotationRows = [page(PHOTO, [region('r1')])]
    renderReviewer([PHOTO])
    await screen.findByTestId('region-r1')
    expect(drawnRect('r1')).toEqual({ x: '0.1', y: '0.2', w: '0.3', h: '0.4' })

    await rotate(1)

    // 90° по часовой: левый край рамки становится верхним, нижний — левым.
    await waitFor(() => expect(drawnRect('r1').y).toBe('0.1'))
    const shown = drawnRect('r1')
    expect(Number(shown.x)).toBeCloseTo(0.4, 12)
    expect(shown.w).toBe('0.4')
    expect(shown.h).toBe('0.3')
  })

  it('страница ложится набок — коробка меняет пропорцию', async () => {
    annotationRows = [page(PHOTO, [], undefined)]
    renderReviewer([PHOTO])
    await screen.findByTestId('review-rotate-1')
    const upright = pageAspect(1)

    await rotate(1)

    await waitFor(() => expect(pageAspect(1)).not.toBe(upright))
    expect(pageAspect(1)).toBeCloseTo(1 / upright, 10)
  })

  it('поворот одной страницы не трогает рамки другой', async () => {
    annotationRows = [page(PHOTO, [region('r1')]), page(SECOND, [region('r2')])]
    renderReviewer([PHOTO, SECOND])
    await screen.findByTestId('region-r2')
    const untouched = drawnRect('r2')

    await rotate(1)

    await waitFor(() => expect(drawnRect('r1').y).toBe('0.1'))
    expect(drawnRect('r2')).toEqual(untouched)
    // По второй странице вообще ничего не записывалось.
    expect(saved.some(row => row.file_path === SECOND)).toBe(false)
  })

  it('ЧЕТЫРЕ ПОВОРОТА ПОДРЯД возвращают ровно исходные числа', async () => {
    annotationRows = [page(PHOTO, [region('r1')])]
    renderReviewer([PHOTO])
    await screen.findByTestId('region-r1')
    const before = drawnRect('r1')
    const aspectBefore = pageAspect(1)

    for (let press = 0; press < 4; press += 1) await rotate(1)

    await waitFor(() => expect(lastSaveFor(PHOTO).data.rotation).toBe(0))
    expect(drawnRect('r1')).toEqual(before)
    expect(pageAspect(1)).toBe(aspectBefore)
    expect(lastSaveFor(PHOTO).data.objects[0].rect).toEqual(RECT)
  })

  it('при повторном открытии работа уже выправлена', async () => {
    // Ровно то, что лежало бы в базе после поворота в прошлый раз.
    annotationRows = [page(PHOTO, [region('r1')], 1)]
    renderReviewer([PHOTO])

    await waitFor(() => expect(drawnRect('r1').y).toBe('0.1'))
    expect(Number(drawnRect('r1').x)).toBeCloseTo(0.4, 12)
  })

  it('правка рамки на повёрнутой странице пишется в исходных координатах', async () => {
    annotationRows = [page(PHOTO, [region('r1')], 1)]
    const notesApiRef: { current: AttemptNotesApi | null } = { current: null }
    renderReviewer([PHOTO], { notesApiRef })
    await screen.findByTestId('region-r1')

    // Выделяем рамку (тем же путём, что клик по строке задания) и двигаем
    // стрелкой «вниз». Страница довёрнута на 90°, поэтому «вниз по экрану» —
    // это «вправо по исходной странице»: сдвинуться обязан x, а не y. Без
    // учёта угла стрелки поехали бы поперёк того, что видит человек.
    await waitFor(() => expect(notesApiRef.current).toBeTruthy())
    await act(async () => { notesApiRef.current!.focusNote('r1') })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyUp(window, { key: 'ArrowDown' })

    await waitFor(() => expect(lastSaveFor(PHOTO)).toBeTruthy())
    const stored = lastSaveFor(PHOTO).data.objects[0].rect
    expect(stored.x).toBeGreaterThan(RECT.x)
    expect(stored.y).toBeCloseTo(RECT.y, 10)
    expect(stored.w).toBeCloseTo(RECT.w, 10)
    expect(stored.h).toBeCloseTo(RECT.h, 10)
    // Рамка на экране при этом уехала именно вниз, а не вбок.
    expect(Number(drawnRect('r1').y)).toBeGreaterThan(0.1)
    expect(Number(drawnRect('r1').x)).toBeCloseTo(0.4, 10)
    // Угол страницы правка рамки не потеряла.
    expect(lastSaveFor(PHOTO).data.rotation).toBe(1)
  })

  it('в слепке для «Скачать PDF» едет угол и уже повёрнутая рамка', async () => {
    annotationRows = [page(PHOTO, [region('r1')])]
    const exportRef: { current: (() => AttemptExportSnapshot) | null } = { current: null }
    renderReviewer([PHOTO], { exportRef })
    await waitFor(() => expect(exportRef.current?.().ready).toBe(true))
    expect(exportRef.current!().surfaces[0].quarter).toBe(0)

    await rotate(1)

    await waitFor(() => expect(exportRef.current!().surfaces[0].quarter).toBe(1))
    const exported = exportRef.current!().regions[0]
    expect(exported.rect.y).toBeCloseTo(0.1, 12)
    expect(exported.rect.x).toBeCloseTo(0.4, 12)
    expect(exported.rect.w).toBeCloseTo(0.4, 12)
    expect(exported.rect.h).toBeCloseTo(0.3, 12)
  })
})

describe('§211 — поворот глазами ученика', () => {
  it('страница выправлена и у него, но крутить её он не может', async () => {
    // Поворот — свойство СТРАНИЦЫ, а не смотрящего: выправили один раз и
    // навсегда, для всех. А вот кнопки в режиме чтения нет: сохранять
    // ученику некуда, и кнопка, которая молча ничего не делает, хуже её
    // отсутствия.
    annotationRows = [page(PHOTO, [region('r1')], 1)]
    render(
      <SubmissionReviewer
        attemptId="att-1"
        bucket="topic-homework-attempts"
        filePath={PHOTO}
        filePaths={[PHOTO]}
        readOnly
      />,
    )

    await waitFor(() => expect(drawnRect('r1').y).toBe('0.1'))
    expect(screen.queryByTestId('review-rotate-1')).not.toBeInTheDocument()
  })
})

describe('§211 — «По ширине»', () => {
  it('возвращает масштаб к вписанному в колонку', async () => {
    renderReviewer([PHOTO])
    await screen.findByTestId('review-fit-width')

    fireEvent.click(screen.getByTitle('Увеличить'))
    fireEvent.click(screen.getByTitle('Увеличить'))
    expect(screen.getByTestId('review-zoom-value').textContent).toBe('140%')
    expect(screen.getByTestId('review-fit-width').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByTestId('review-fit-width'))
    expect(screen.getByTestId('review-zoom-value').textContent).toBe('100%')
    expect(screen.getByTestId('review-fit-width').getAttribute('aria-pressed')).toBe('true')
  })

  it('после поворота подгонка применяется заново — к новому отношению сторон', async () => {
    renderReviewer([PHOTO])
    await screen.findByTestId('review-rotate-1')
    const upright = pageAspect(1)

    fireEvent.click(screen.getByTitle('Увеличить'))
    fireEvent.click(screen.getByTestId('review-fit-width'))

    await rotate(1)

    await waitFor(() => expect(pageAspect(1)).not.toBe(upright))
    // Страница снова вписана в колонку, но уже лежащая набок.
    expect(screen.getByTestId('review-zoom-value').textContent).toBe('100%')
    expect(screen.getByTestId('review-fit-width').getAttribute('aria-pressed')).toBe('true')
  })

  it('выбранный руками масштаб поворот не сбрасывает', async () => {
    renderReviewer([PHOTO])
    await screen.findByTestId('review-rotate-1')

    fireEvent.click(screen.getByTitle('Увеличить'))
    expect(screen.getByTestId('review-zoom-value').textContent).toBe('120%')

    await rotate(1)

    expect(screen.getByTestId('review-zoom-value').textContent).toBe('120%')
    expect(screen.getByTestId('review-fit-width').getAttribute('aria-pressed')).toBe('false')
  })
})
