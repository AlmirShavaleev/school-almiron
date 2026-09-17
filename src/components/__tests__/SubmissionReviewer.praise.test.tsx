import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * §199. Похвалы в колонке «Комментарии» — под переключателем, по умолчанию
 * выключенным.
 *
 * Причина простая: при проверке нужны ошибки. Модель до §180 сыпала «Отлично!»
 * на каждое верное задание, и замечание, ради которого преподаватель открыл
 * работу, оказывалось четвёртым сверху. Сами находки `praise` при этом никуда
 * не деваются — ученику они полезны, и в режиме чтения переключателя нет.
 */

vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
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

let selectResult: { data: unknown; error: unknown } = { data: [], error: null }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const readChain: any = {
        eq: () => readChain,
        in: () => readChain,
        then: (res: any) => Promise.resolve(selectResult).then(res),
      }
      return { select: () => readChain, upsert: () => Promise.resolve({ error: null }), update: () => readChain }
    },
    rpc: () => Promise.resolve({ data: [{ ai_findings: 0, teacher_regions: 2 }], error: null }),
  },
}))

import { SubmissionReviewer } from '@/components/SubmissionReviewer'

const region = (id: string, category: string, text: string) => ({
  id, type: 'region', category, text, rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
})

const pageRow = (objects: unknown[]) => ({
  page: 1,
  file_path: 'att-1/scan.jpg',
  status: 'draft',
  author_id: 'teacher-1',
  data: { version: 2, objects },
})

async function renderReady(props: { readOnly?: boolean } = {}) {
  render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath="att-1/scan.jpg" {...props} />)
  await screen.findByTestId('comment-list')
}

const texts = () => screen.queryAllByTestId('comment-list-item').map(el => el.textContent ?? '')

describe('SubmissionReviewer: переключатель похвал', () => {
  beforeEach(() => {
    selectResult = {
      data: [pageRow([
        region('r1', 'praise', 'Отлично!'),
        region('r2', 'calc', 'Знак ускорения'),
        region('r3', 'praise', 'Верное решение'),
      ])],
      error: null,
    }
  })

  it('по умолчанию в списке только замечания', async () => {
    await renderReady()
    expect(texts().some(t => t.includes('Знак ускорения'))).toBe(true)
    expect(texts().some(t => t.includes('Отлично!'))).toBe(false)
    expect(texts().some(t => t.includes('Верное решение'))).toBe(false)
  })

  it('переключатель показывает похвалы и убирает их обратно', async () => {
    await renderReady()
    const toggle = screen.getByLabelText('Показывать похвалы')

    fireEvent.click(toggle)
    expect(texts()).toHaveLength(3)
    expect(texts().some(t => t.includes('Отлично!'))).toBe(true)

    fireEvent.click(toggle)
    expect(texts()).toHaveLength(1)
  })

  it('похвал нет — нет и переключателя: нечего прятать', async () => {
    selectResult = { data: [pageRow([region('r2', 'calc', 'Знак ускорения')])], error: null }
    await renderReady()
    expect(screen.queryByTestId('comment-list-praise-toggle')).not.toBeInTheDocument()
    expect(texts()).toHaveLength(1)
  })

  it('в списке одни похвалы — пустой список объясняет себя, а не врёт', async () => {
    selectResult = { data: [pageRow([region('r1', 'praise', 'Отлично!')])], error: null }
    await renderReady()
    expect(texts()).toHaveLength(0)
    expect(screen.getByTestId('comment-list')).toHaveTextContent('Только похвалы: 1')
  })

  it('в режиме чтения (ученик) похвалы видны и переключателя нет', async () => {
    await renderReady({ readOnly: true })
    expect(screen.queryByTestId('comment-list-praise-toggle')).not.toBeInTheDocument()
    expect(texts().some(t => t.includes('Отлично!'))).toBe(true)
  })
})
