import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

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
  getSignedFileUrl: async () => 'blob://fake.pdf',
}))

let selectResult: { data: unknown; error: unknown } = { data: [], error: null }
let counts = { ai_findings: 0, teacher_regions: 0 }
const rpcSpy = vi.fn()

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
    rpc: (...args: unknown[]) => {
      rpcSpy(...args)
      return Promise.resolve({ data: [counts], error: null })
    },
  },
}))

import { SubmissionReviewer } from '@/components/SubmissionReviewer'

/** Одна рамка преподавателя на странице — чтобы список комментариев был не пуст. */
const oneRegionRow = {
  page: 1,
  file_path: 'att-1/scan.jpg',
  status: 'draft',
  author_id: 'teacher-1',
  data: {
    version: 2,
    objects: [{ id: 'r1', type: 'region', category: 'logic', text: 'Неверный ход', rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } }],
  },
}

const clearCalls = () => rpcSpy.mock.calls.filter(c => c[0] === 'topic_homework_clear_marks' && (c[1] as any)?.p_dry_run === false)

async function renderReady(props: { onMarksCleared?: () => void } = {}) {
  render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath="att-1/scan.jpg" {...props} />)
  return await screen.findByTestId('clear-marks-button')
}

/**
 * §156. «Очистить пометки»: три исхода и число в подтверждении.
 * Удаление необратимо, поэтому без подтверждения в базу не уходит ничего.
 */
describe('SubmissionReviewer — «Очистить пометки»', () => {
  beforeEach(() => {
    rpcSpy.mockReset()
    toastError.mockReset()
    toastSuccess.mockReset()
    selectResult = { data: [oneRegionRow], error: null }
    counts = { ai_findings: 8, teacher_regions: 3 }
  })

  it('нажатие без подтверждения ничего не удаляет — только открывает диалог с числом', async () => {
    const button = await renderReady()
    fireEvent.click(button)
    const dialog = await screen.findByTestId('clear-marks-dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByTestId('clear-marks-text')).toHaveTextContent('Удалить 8 находок ИИ и 3 рамки проверяющих? Это необратимо.')
    expect(screen.getByTestId('clear-marks-text')).not.toHaveTextContent(/ваш/i)
    expect(clearCalls()).toHaveLength(0)
    // Счёт шёл только dry run'ом.
    expect(rpcSpy.mock.calls.every(c => (c[1] as any)?.p_dry_run === true)).toBe(true)
  })

  it('отмена — ничего не удаляет, диалог закрыт, рамки на месте', async () => {
    const button = await renderReady()
    fireEvent.click(button)
    await screen.findByTestId('clear-marks-dialog')
    fireEvent.click(screen.getByTestId('clear-marks-cancel'))
    await waitFor(() => expect(screen.queryByTestId('clear-marks-dialog')).not.toBeInTheDocument())
    expect(clearCalls()).toHaveLength(0)
    expect(screen.getAllByTestId('comment-list-item')).toHaveLength(1)
  })

  it('подтверждение — удаляет всё через RPC, список пуст, снаружи перечитывают ИИ', async () => {
    const onMarksCleared = vi.fn()
    const button = await renderReady({ onMarksCleared })
    fireEvent.click(button)
    await screen.findByTestId('clear-marks-dialog')
    fireEvent.click(screen.getByTestId('clear-marks-confirm'))

    await waitFor(() => expect(clearCalls()).toHaveLength(1))
    expect(clearCalls()[0][1]).toEqual({ p_attempt_id: 'att-1', p_dry_run: false })
    await waitFor(() => expect(screen.queryByTestId('clear-marks-dialog')).not.toBeInTheDocument())
    expect(screen.queryByTestId('comment-list-item')).not.toBeInTheDocument()
    expect(onMarksCleared).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('нечего удалять — кнопка неактивна', async () => {
    selectResult = { data: [], error: null }
    counts = { ai_findings: 0, teacher_regions: 0 }
    const button = await renderReady()
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)
    expect(screen.queryByTestId('clear-marks-dialog')).not.toBeInTheDocument()
  })

  it('в режиме только просмотра кнопки нет', async () => {
    render(<SubmissionReviewer attemptId="att-1" bucket="topic-homework-attempts" filePath="att-1/scan.jpg" readOnly />)
    await screen.findByTestId('comment-list')
    expect(screen.queryByTestId('clear-marks-button')).not.toBeInTheDocument()
  })
})
