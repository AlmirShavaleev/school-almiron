import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

vi.mock('@/store/toastStore', () => ({ toast: { error: vi.fn() } }))
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

const signedFor = vi.fn()
vi.mock('@/lib/storage', () => ({
  forgetSignedUrl: () => {},
  SIGNED_URL_TTL_S: 3600,
  SHORT_SIGNED_URL_TTL_S: 300,
  UPLOAD_CACHE_CONTROL_S: '31536000',
  extractStoragePath: (p: string) => p,
  getSignedFileUrl: async (bucket: string, path: string) => {
    signedFor(bucket, path)
    return 'blob://fake.jpg'
  },
}))

/** Что именно ушло в PostgREST — по этому и проверяем адресацию контура. */
let selectResult: { data: unknown; error: unknown } = { data: [], error: null }
const selectEq: [string, unknown][] = []
const updateEq: [string, unknown][] = []
const upsertCalls: { payload: any; options: any }[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const readChain: any = {
        eq: (col: string, val: unknown) => { selectEq.push([col, val]); return readChain },
        in: () => readChain,
        then: (res: any) => Promise.resolve(selectResult).then(res),
      }
      const updateChain: any = {
        eq: (col: string, val: unknown) => { updateEq.push([col, val]); return updateChain },
        in: () => updateChain,
        then: (res: any) => Promise.resolve({ error: null }).then(res),
      }
      return {
        select: () => readChain,
        upsert: (payload: any, options: any) => {
          upsertCalls.push({ payload, options })
          return Promise.resolve({ error: null })
        },
        update: () => updateChain,
      }
    },
  },
}))

import { SubmissionReviewer } from '@/components/SubmissionReviewer'

const REGION_ROW = {
  page: 1,
  file_path: 'att-1/photo.jpg',
  status: 'draft',
  data: {
    version: 2,
    objects: [{
      id: 'r1', type: 'region', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
      category: 'calc', text: 'Ошибка в знаке',
    }],
  },
}

describe('SubmissionReviewer — адресация контура ДЗ', () => {
  beforeEach(() => {
    selectResult = { data: [], error: null }
    selectEq.length = 0
    updateEq.length = 0
    upsertCalls.length = 0
    signedFor.mockReset()
  })

  it('новый контур: читает, сохраняет и публикует по attempt_id, из бакета попыток', async () => {
    selectResult = { data: [REGION_ROW], error: null }
    render(
      <SubmissionReviewer
        attemptId="att-1"
        bucket="topic-homework-attempts"
        filePath="att-1/photo.jpg"
        publishButtonLabel="Опубликовать пометки"
      />,
    )
    await waitFor(() => expect(screen.getByText('Опубликовать пометки')).toBeInTheDocument())

    // файл подписан в бакете нового контура, а не в 'homeworks'
    expect(signedFor).toHaveBeenCalledWith('topic-homework-attempts', 'att-1/photo.jpg')
    // чтение рамок — по attempt_id
    expect(selectEq).toContainEqual(['attempt_id', 'att-1'])
    expect(selectEq.some(([col]) => col === 'submission_id')).toBe(false)

    fireEvent.click(screen.getByText('Опубликовать пометки'))
    await waitFor(() => expect(upsertCalls.length).toBeGreaterThan(0))

    // сохранение — с attempt_id и правильным арбитром ON CONFLICT
    expect(upsertCalls[0].payload).toMatchObject({ attempt_id: 'att-1', page: 1 })
    expect(upsertCalls[0].payload.submission_id).toBeUndefined()
    expect(upsertCalls[0].options).toEqual({ onConflict: 'attempt_id,file_path,page' })
    // публикация — тоже по attempt_id
    await waitFor(() => expect(updateEq).toContainEqual(['attempt_id', 'att-1']))
  })

  it('старый контур не задет: submissionId по-прежнему адресует submission_id и бакет homeworks', async () => {
    selectResult = { data: [{ ...REGION_ROW, file_path: 'sub-1/scan.jpg' }], error: null }
    render(<SubmissionReviewer submissionId="sub-1" filePath="sub-1/scan.jpg" />)
    await waitFor(() => expect(screen.getByText('Опубликовать проверку')).toBeInTheDocument())

    expect(signedFor).toHaveBeenCalledWith('homeworks', 'sub-1/scan.jpg')
    expect(selectEq).toContainEqual(['submission_id', 'sub-1'])
    expect(selectEq.some(([col]) => col === 'attempt_id')).toBe(false)

    fireEvent.click(screen.getByText('Опубликовать проверку'))
    await waitFor(() => expect(upsertCalls.length).toBeGreaterThan(0))
    expect(upsertCalls[0].payload).toMatchObject({ submission_id: 'sub-1' })
    expect(upsertCalls[0].payload.attempt_id).toBeUndefined()
    expect(upsertCalls[0].options).toEqual({ onConflict: 'submission_id,file_path,page' })
  })

  it('publishRef отдаёт публикацию наружу — форма вердикта публикует пометки до вердикта', async () => {
    selectResult = { data: [REGION_ROW], error: null }
    const publishRef: { current: ((t?: 'checked' | 'revision') => Promise<boolean>) | null } = { current: null }

    render(
      <SubmissionReviewer
        attemptId="att-1"
        bucket="topic-homework-attempts"
        filePath="att-1/photo.jpg"
        publishRef={publishRef}
      />,
    )
    await waitFor(() => expect(publishRef.current).toBeTruthy())

    await waitFor(async () => {
      expect(await publishRef.current!('revision')).toBe(true)
    })
    expect(updateEq).toContainEqual(['attempt_id', 'att-1'])
  })
})
