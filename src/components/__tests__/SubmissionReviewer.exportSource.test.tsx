/**
 * §206. Слепок для «Скачать PDF»: что именно аннотатор отдаёт сборщику файла.
 *
 * Проверяется ровно то, что потом видно в готовом PDF глазами: порядок
 * страниц при нескольких файлах и сквозная нумерация рамок. Нумерация здесь
 * важнее всего: номер в кружке на странице работы и номер пункта в разборе на
 * последней странице — одно и то же число, иначе страницы работы и разбор в
 * конце читаются как два разных документа.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn(), saved: vi.fn() } }))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  // Единственный PDF в этих сценариях — двухстраничный.
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: () => Promise.resolve({
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
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const readChain: any = {
        eq: () => readChain,
        in: () => readChain,
        then: (res: any) => Promise.resolve({ data: annotationRows, error: null }).then(res),
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
  countAttemptMarks: async () => ({ ai: 0, regions: 0 }),
  clearAttemptMarks: async () => ({ ai: 0, regions: 0 }),
  clearMarksPrompt: () => '',
  hasAnyMarks: () => false,
}))

import { SubmissionReviewer } from '@/components/SubmissionReviewer'
import type { AttemptExportSnapshot } from '@/lib/attemptPdfSource'

function region(id: string, text: string, category: string, y: number) {
  return { id, type: 'region', rect: { x: 0.1, y, w: 0.3, h: 0.1 }, category, text }
}

async function snapshotOf(paths: string[]): Promise<AttemptExportSnapshot> {
  const ref: { current: (() => AttemptExportSnapshot) | null } = { current: null }
  render(
    <SubmissionReviewer
      attemptId="att-1"
      bucket="topic-homework-attempts"
      filePath={paths[0]}
      filePaths={paths}
      exportSourceRef={ref}
    />,
  )
  await waitFor(() => {
    const snapshot = ref.current?.()
    expect(snapshot && snapshot.surfaces.length).toBeTruthy()
  })
  return ref.current!()
}

describe('SubmissionReviewer — слепок для «Скачать PDF»', () => {
  beforeEach(() => { annotationRows = [] })

  it('страницы идут файл за файлом, страница за страницей', async () => {
    annotationRows = []
    const snapshot = await snapshotOf(['att-1/a.jpg', 'att-1/b.pdf', 'att-1/c.jpg'])

    expect(snapshot.surfaces.map(s => s.globalPage)).toEqual([1, 2, 3, 4])
    expect(snapshot.surfaces.map(s => s.kind)).toEqual(['image', 'pdf', 'pdf', 'image'])
    // Вторая и третья страницы — это первый и второй лист одного PDF.
    expect(snapshot.surfaces[1].page).toBe(1)
    expect(snapshot.surfaces[2].page).toBe(2)
    expect(snapshot.surfaces[1].pdf).not.toBeNull()
    expect(snapshot.surfaces[0].pdf).toBeNull()
    expect(snapshot.surfaces[0].url).toBe('signed://att-1/a.jpg')
  })

  it('рамки нумеруются сквозь весь документ, в порядке страниц', async () => {
    annotationRows = [
      { page: 1, file_path: 'att-1/b.pdf', status: 'draft', data: { version: 2, objects: [region('r2', 'Вторая', 'logic', 0.2)] } },
      { page: 2, file_path: 'att-1/b.pdf', status: 'draft', data: { version: 2, objects: [region('r3', 'Третья', 'praise', 0.3)] } },
      { page: 1, file_path: 'att-1/a.jpg', status: 'draft', data: { version: 2, objects: [region('r1', 'Первая', 'calc', 0.1)] } },
    ]
    const snapshot = await snapshotOf(['att-1/a.jpg', 'att-1/b.pdf'])

    expect(snapshot.regions.map(r => [r.number, r.globalPage, r.text])).toEqual([
      [1, 1, 'Первая'],
      [2, 2, 'Вторая'],
      [3, 3, 'Третья'],
    ])
    // Цвет и подпись категории — те же, что рисуются на экране.
    expect(snapshot.regions[0].color).toBe('#dc2626')
    expect(snapshot.regions[0].categoryLabel).toBe('Вычислительная ошибка')
    expect(snapshot.regions[0].rect).toEqual({ x: 0.1, y: 0.1, w: 0.3, h: 0.1 })
  })

  it('работа без рамок отдаёт страницы и пустой список замечаний', async () => {
    annotationRows = []
    const snapshot = await snapshotOf(['att-1/a.jpg'])
    expect(snapshot.surfaces).toHaveLength(1)
    expect(snapshot.regions).toEqual([])
  })
})
