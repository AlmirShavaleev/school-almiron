import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createRef } from 'react'
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

/**
 * Хранилище страниц: `select` отдаёт то, что лежит, `upsert` перезаписывает
 * страницу целиком — ровно как PostgREST с `onConflict`. Без этого повторный
 * перенос проверить нечем: весь смысл в том, ЧТО оказалось в базе.
 */
type Row = { page: number; file_path: string; status: string; author_id: string | null; data: any }
let stored: Row[] = []
const upserts: Row[] = []
/** Чтение страниц «зависло» — проверяем, что перенос в этот момент недоступен. */
let holdSelect = false

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const readChain: any = {
        eq: () => readChain,
        in: () => readChain,
        then: (res: any) => (holdSelect
          ? new Promise(() => {}) as any
          : Promise.resolve({ data: stored, error: null }).then(res)),
      }
      return {
        select: () => readChain,
        update: () => readChain,
        upsert: (row: Row) => {
          upserts.push(row)
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

import { SubmissionReviewer, type ImportedRegion } from '@/components/SubmissionReviewer'

const FILE = 'att-1/scan.jpg'

/** Рамка, нарисованная руками: пометки источника у неё нет и быть не может. */
const HAND_DRAWN = {
  id: 'hand-1',
  type: 'region',
  category: 'logic',
  text: 'Переписать решение целиком',
  rect: { x: 0.5, y: 0.5, w: 0.3, h: 0.1 },
}

const finding = (id: string, y: number, text: string): ImportedRegion => ({
  filePath: FILE,
  page: 1,
  rect: { x: 0.1, y, w: 0.3, h: 0.1 },
  category: 'calc',
  text,
  sourceId: id,
  jobId: 'job-1',
})

const RUN_1: ImportedRegion[] = [
  finding('f1', 0.1, 'Вычислительная ошибка, стр. 2'),
  finding('f2', 0.25, 'Знак ускорения при торможении'),
]

const pageOf = () => stored.find(r => r.file_path === FILE && r.page === 1)
const objects = () => (pageOf()?.data?.objects ?? []) as any[]
const texts = () => objects().filter(o => o.type === 'region').map(o => o.text)

function renderReviewer() {
  const ref = createRef<((regions: ImportedRegion[]) => Promise<number>) | null>() as
    { current: ((regions: ImportedRegion[]) => Promise<number>) | null }
  const dedupe = createRef<(() => Promise<number>) | null>() as
    { current: (() => Promise<number>) | null }
  const onDuplicateFramesChange = vi.fn()
  render(
    <SubmissionReviewer
      attemptId="att-1"
      bucket="topic-homework-attempts"
      filePath={FILE}
      importRegionsRef={ref}
      dedupeFramesRef={dedupe}
      onDuplicateFramesChange={onDuplicateFramesChange}
    />,
  )
  return { ref, dedupe, onDuplicateFramesChange }
}

/**
 * §207. Повторный перенос рамок ИИ.
 *
 * Проверка в базе (попытка 9bf19a80…) показала 11 объектов при 4 находках
 * последнего прогона: «Перенести рамки» дописывал находки в конец страницы, и
 * каждое нажатие после «Проверить заново» клало их новым слоем.
 */
describe('SubmissionReviewer — перенос рамок ИИ идемпотентен', () => {
  beforeEach(() => {
    stored = [{ page: 1, file_path: FILE, status: 'draft', author_id: 'teacher-1', data: { version: 2, objects: [HAND_DRAWN] } }]
    upserts.length = 0
    holdSelect = false
    toastError.mockReset()
  })

  /**
   * Самая опасная гонка: перенос запускается САМ при открытии работы, а
   * страница пишется целиком. Пока пометки из базы не приехали, `pages` пуст
   * не потому, что рамок нет, — и запись из этого состояния стёрла бы работу
   * преподавателя. Поэтому ручки переноса до загрузки просто нет.
   */
  it('страницы ещё не прочитаны — переносить нечем, а не «перенести в пустоту»', async () => {
    holdSelect = true
    const { ref, dedupe } = renderReviewer()
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(ref.current).toBeNull()
    expect(dedupe.current).toBeNull()
    expect(upserts).toHaveLength(0)
  })

  it('второе нажатие не увеличивает число рамок, а ручная рамка остаётся', async () => {
    const { ref } = renderReviewer()
    await waitFor(() => expect(ref.current).toBeTypeOf('function'))

    await act(async () => { await ref.current!(RUN_1) })
    expect(texts()).toEqual([
      'Переписать решение целиком',
      'Вычислительная ошибка, стр. 2',
      'Знак ускорения при торможении',
    ])

    await act(async () => { await ref.current!(RUN_1) })
    await act(async () => { await ref.current!(RUN_1) })

    // Три нажатия — по-прежнему две рамки ИИ и одна ручная, а не девять.
    expect(texts()).toEqual([
      'Переписать решение целиком',
      'Вычислительная ошибка, стр. 2',
      'Знак ускорения при торможении',
    ])
    expect(objects().filter(o => o.source?.kind === 'ai')).toHaveLength(2)
    expect(objects().find(o => o.id === 'hand-1')).toBeTruthy()
    // И на экране столько же: список комментариев — то же содержимое.
    await waitFor(() => expect(screen.getAllByTestId('comment-list-item')).toHaveLength(3))
  })

  it('свежий прогон короче прежнего — лишние рамки ИИ уходят, ручная цела', async () => {
    const { ref } = renderReviewer()
    await waitFor(() => expect(ref.current).toBeTypeOf('function'))
    await act(async () => { await ref.current!(RUN_1) })
    await act(async () => { await ref.current!([finding('f9', 0.4, 'Единицы измерения')]) })

    expect(texts()).toEqual(['Переписать решение целиком', 'Единицы измерения'])
  })

  it('прогон вовсе без находок не стирает ручные пометки', async () => {
    const { ref } = renderReviewer()
    await waitFor(() => expect(ref.current).toBeTypeOf('function'))
    await act(async () => { await ref.current!(RUN_1) })
    await act(async () => { await ref.current!([]) })

    expect(texts()).toEqual(['Переписать решение целиком'])
  })

  it('перенос ничего не меняет — в базу не пишем', async () => {
    const { ref } = renderReviewer()
    await waitFor(() => expect(ref.current).toBeTypeOf('function'))
    await act(async () => { await ref.current!(RUN_1) })
    const after = upserts.length
    await act(async () => { await ref.current!([]) })
    await act(async () => { await ref.current!([]) })
    // Первый пустой перенос убрал рамки ИИ (одна запись), второй — уже нет.
    expect(upserts.length).toBe(after + 1)
  })
})

/**
 * §207. Дубли, накопленные ДО пометки источника, чистятся только видимой
 * кнопкой. Здесь проверяется то, что стоит за кнопкой.
 */
describe('SubmissionReviewer — уборка накопленных повторов', () => {
  const dup = (id: string) => ({ ...HAND_DRAWN, id })

  beforeEach(() => {
    upserts.length = 0
  })

  it('точные совпадения есть — их число уходит наружу, уборка оставляет по одному', async () => {
    stored = [{
      page: 1,
      file_path: FILE,
      status: 'draft',
      author_id: 'teacher-1',
      data: {
        version: 2,
        objects: [
          dup('d1'), dup('d2'), dup('d3'),
          { id: 'other', type: 'region', category: 'calc', text: 'Знак', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
        ],
      },
    }]
    const { dedupe, onDuplicateFramesChange } = renderReviewer()
    await waitFor(() => expect(onDuplicateFramesChange).toHaveBeenCalledWith(2))

    let removed = 0
    await act(async () => { removed = await dedupe.current!() })
    expect(removed).toBe(2)
    expect(objects().map(o => o.id)).toEqual(['d1', 'other'])
    await waitFor(() => expect(onDuplicateFramesChange).toHaveBeenLastCalledWith(0))
  })

  it('точных совпадений нет — наружу ноль, и убирать нечего', async () => {
    stored = [{
      page: 1,
      file_path: FILE,
      status: 'draft',
      author_id: 'teacher-1',
      data: {
        version: 2,
        objects: [
          HAND_DRAWN,
          { id: 'other', type: 'region', category: 'calc', text: 'Знак', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
        ],
      },
    }]
    const { dedupe, onDuplicateFramesChange } = renderReviewer()
    await waitFor(() => expect(screen.getAllByTestId('comment-list-item')).toHaveLength(2))
    expect(onDuplicateFramesChange).toHaveBeenLastCalledWith(0)

    let removed = 0
    await act(async () => { removed = await dedupe.current!() })
    expect(removed).toBe(0)
    expect(upserts).toHaveLength(0)
    expect(objects()).toHaveLength(2)
  })
})

/**
 * §207. Абзац «Клик открывает место в работе…» ушёл под знак вопроса: текст
 * верный, но читают его один раз, а место он занимал всегда.
 */
describe('SubmissionReviewer — подсказка про рамки под знаком вопроса', () => {
  beforeEach(() => {
    stored = [{ page: 1, file_path: FILE, status: 'draft', author_id: 'teacher-1', data: { version: 2, objects: [HAND_DRAWN] } }]
  })

  it('на экране абзаца нет, по знаку вопроса — есть', async () => {
    render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath={FILE} />)
    const list = await screen.findByTestId('comment-list')
    expect(list.textContent).not.toContain('Клик открывает место')
    fireEvent.click(screen.getByTestId('reviewer-marks-hint-toggle'))
    expect(screen.getByTestId('reviewer-marks-hint')).toHaveTextContent('Клик открывает место в работе')
  })
})
