import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { error: toastError } }))

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
  extractStoragePath: (p: string) => p,
  getSignedFileUrl: async () => 'blob://fake.pdf',
}))

let selectResult: { data: unknown; error: unknown } = { data: [], error: null }
let upsertResult: { error: unknown } = { error: null }
let updateResult: { error: unknown } = { error: null }
const fromSpy = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromSpy(...args) },
}))

function makeAnnotationTable() {
  const readChain: any = { eq: () => readChain, then: (res: any) => Promise.resolve(selectResult).then(res) }
  const updateChain: any = { eq: () => updateChain, then: (res: any) => Promise.resolve(updateResult).then(res) }
  return {
    select: () => readChain,
    upsert: () => Promise.resolve(upsertResult),
    update: () => updateChain,
  }
}

import { SubmissionReviewer } from '@/components/SubmissionReviewer'

describe('SubmissionReviewer.publish() — onPublishComplete on every exit path', () => {
  beforeEach(() => {
    selectResult = { data: [], error: null }
    upsertResult = { error: null }
    updateResult = { error: null }
    fromSpy.mockReset()
    toastError.mockReset()
    fromSpy.mockImplementation((table: string) => table === 'annotation_sets' ? makeAnnotationTable() : makeAnnotationTable())
  })

  async function renderAndWaitReady(props: Partial<Extract<React.ComponentProps<typeof SubmissionReviewer>, { submissionId: string }>> = {}) {
    render(<SubmissionReviewer submissionId="sub-1" filePath="submissions/x/y.pdf" {...props} />)
    await waitFor(() => expect(screen.getByText('Опубликовать проверку')).toBeInTheDocument())
  }

  it('calls onPublishComplete(false) when onPublish rejects publish, without touching annotations', async () => {
    const onPublish = vi.fn().mockResolvedValue(false)
    const onPublishComplete = vi.fn()
    await renderAndWaitReady({ onPublish, onPublishComplete })

    fireEvent.click(screen.getByText('Опубликовать проверку'))
    await waitFor(() => expect(onPublishComplete).toHaveBeenCalledWith(false))
    expect(screen.getByText('Опубликовать проверку')).toBeInTheDocument()
  })

  it('calls onPublishComplete(false) when saving a region page fails', async () => {
    selectResult = {
      data: [{
        page: 1,
        data: { version: 2, objects: [{ id: 'r1', type: 'region', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 }, category: 'calc', text: 'Ошибка в вычислениях' }] },
        status: 'draft',
      }],
      error: null,
    }
    upsertResult = { error: { message: 'save failed' } }
    const onPublishComplete = vi.fn()
    await renderAndWaitReady({ onPublishComplete })

    fireEvent.click(screen.getByText('Опубликовать проверку'))
    await waitFor(() => expect(onPublishComplete).toHaveBeenCalledWith(false))
  })

  it('shows a permission-specific toast on annotation save RLS denial', async () => {
    selectResult = {
      data: [{
        page: 1,
        data: { version: 2, objects: [{ id: 'r1', type: 'region', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 }, category: 'calc', text: 'Ошибка в вычислениях' }] },
        status: 'draft',
      }],
      error: null,
    }
    upsertResult = { error: { code: '42501', message: 'new row violates row-level security policy for table "annotation_sets"' } }
    await renderAndWaitReady()

    fireEvent.click(screen.getByText('Опубликовать проверку'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Нет прав на сохранение проверки'))
  })

  it('shows a retry/network toast on non-permission annotation save failure', async () => {
    selectResult = {
      data: [{
        page: 1,
        data: { version: 2, objects: [{ id: 'r1', type: 'region', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 }, category: 'logic', text: 'Пропущен шаг' }] },
        status: 'draft',
      }],
      error: null,
    }
    upsertResult = { error: { message: 'fetch failed' } }
    await renderAndWaitReady()

    fireEvent.click(screen.getByText('Опубликовать проверку'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось сохранить проверку. Проверьте соединение и попробуйте ещё раз'))
  })

  it('calls onPublishComplete(false) when final status update fails', async () => {
    selectResult = {
      data: [{
        page: 1,
        data: { version: 2, objects: [{ id: 'r1', type: 'region', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 }, category: 'logic', text: 'Пропущен шаг' }] },
        status: 'draft',
      }],
      error: null,
    }
    upsertResult = { error: null }
    updateResult = { error: { message: 'update failed' } }
    const onPublishComplete = vi.fn()
    await renderAndWaitReady({ onPublishComplete })

    fireEvent.click(screen.getByText('Опубликовать проверку'))
    await waitFor(() => expect(onPublishComplete).toHaveBeenCalledWith(false))
  })

  it('calls onPublishComplete(true) after fully successful publish', async () => {
    selectResult = {
      data: [{
        page: 1,
        data: { version: 2, objects: [{ id: 'r1', type: 'region', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 }, category: 'praise', text: '' }] },
        status: 'draft',
      }],
      error: null,
    }
    const onPublish = vi.fn().mockResolvedValue(true)
    const onPublishComplete = vi.fn()
    await renderAndWaitReady({ onPublish, onPublishComplete })

    fireEvent.click(screen.getByText('Опубликовать проверку'))
    await waitFor(() => expect(onPublishComplete).toHaveBeenCalledWith(true))
    await waitFor(() => expect(screen.getByText('Опубликовать снова')).toBeInTheDocument())
  })

  it('forwards the grading-card revision trigger into the publish path target status', async () => {
    const onPublish = vi.fn().mockResolvedValue(true)
    const onPublishComplete = vi.fn()
    await renderAndWaitReady({
      onPublish,
      onPublishComplete,
      footer: ({ triggerPublish }) => (
        <button type="button" onClick={() => triggerPublish('revision')}>
          Отправить на доработку
        </button>
      ),
    })

    fireEvent.click(screen.getByText('Отправить на доработку'))
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith('revision'))
    await waitFor(() => expect(onPublishComplete).toHaveBeenCalledWith(true))
  })
})
