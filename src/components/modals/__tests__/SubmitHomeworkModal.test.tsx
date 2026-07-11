import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))

const createObjectURLSpy = vi.fn((file: File) => `blob:${file.name}`)
const revokeObjectURLSpy = vi.fn()
vi.stubGlobal('URL', { ...URL, createObjectURL: createObjectURLSpy, revokeObjectURL: revokeObjectURLSpy })

const callOrder: string[] = []
const uploadSpy = vi.fn()
const insertFilesSpy = vi.fn()
const insertSubmissionSpy = vi.fn()
const updateSubmissionSpy = vi.fn()

let uploadResult: { error: { message: string } | null } = { error: null }
let uploadShouldDefer = false
let uploadDeferred: ((value: { error: { message: string } | null }) => void) | null = null

let maybeSingleResult: { data: any; error: { message: string } | null } = { data: null, error: null }
let insertSubmissionResult: { data: any; error: { message: string } | null } = { data: { id: 'sub-new' }, error: null }
let updateSubmissionResult: { data: any; error: { message: string } | null } = { data: [{ id: 'sub-new' }], error: null }
let insertFilesResult: { error: { message: string } | null } = { error: null }
let fileRowsResult: { data: any[]; error: { message: string } | null } = { data: [], error: null }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'homework_submissions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => {
                  callOrder.push('submission:maybeSingle')
                  return Promise.resolve(maybeSingleResult)
                },
              }),
            }),
          }),
          insert: (payload: unknown) => {
            insertSubmissionSpy(payload)
            callOrder.push('submission:insert')
            return {
              select: () => ({
                single: () => Promise.resolve(insertSubmissionResult),
              }),
            }
          },
          update: (payload: unknown) => {
            updateSubmissionSpy(payload)
            callOrder.push('submission:update')
            return {
              eq: () => ({
                in: () => ({
                  select: () => Promise.resolve(updateSubmissionResult),
                }),
              }),
            }
          },
        }
      }
      if (table === 'homework_submission_files') {
        return {
          insert: (payload: unknown) => {
            insertFilesSpy(payload)
            callOrder.push('files:insert')
            return Promise.resolve(insertFilesResult)
          },
          select: () => ({
            eq: () => {
              callOrder.push('files:select')
              return Promise.resolve(fileRowsResult)
            },
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        }
      }
      return {}
    },
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => {
          uploadSpy(...args)
          callOrder.push('storage:upload')
          if (uploadShouldDefer) {
            return new Promise(resolve => { uploadDeferred = resolve })
          }
          return Promise.resolve(uploadResult)
        },
      }),
    },
  },
}))

import { SubmitHomeworkModal } from '@/components/modals/SubmitHomeworkModal'

const homework = { id: 'hw-1', title: 'ДЗ', max_score: 100 }
const pdfFile = new File(['pdf'], 'solution.pdf', { type: 'application/pdf' })
const jpgFile = new File(['jpg'], 'page-2.jpg', { type: 'image/jpeg' })
const heicFile = new File(['heic'], 'photo.heic', { type: 'image/heic' })
const bigFile = new File([new Uint8Array(11 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' })
const nineMbA = new File([new Uint8Array(9 * 1024 * 1024)], 'big-1.pdf', { type: 'application/pdf' })
const nineMbB = new File([new Uint8Array(9 * 1024 * 1024)], 'big-2.pdf', { type: 'application/pdf' })
const nineMbC = new File([new Uint8Array(9 * 1024 * 1024)], 'big-3.pdf', { type: 'application/pdf' })
const nineMbD = new File([new Uint8Array(9 * 1024 * 1024)], 'big-4.pdf', { type: 'application/pdf' })
const nineMbE = new File([new Uint8Array(9 * 1024 * 1024)], 'big-5.pdf', { type: 'application/pdf' })

describe('SubmitHomeworkModal — multi-file submit flow', () => {
  beforeEach(() => {
    callOrder.length = 0
    uploadSpy.mockReset()
    insertFilesSpy.mockReset()
    insertSubmissionSpy.mockReset()
    updateSubmissionSpy.mockReset()
    toastSuccess.mockReset()
    createObjectURLSpy.mockClear()
    revokeObjectURLSpy.mockClear()
    maybeSingleResult = { data: null, error: null }
    insertSubmissionResult = { data: { id: 'sub-new' }, error: null }
    updateSubmissionResult = { data: [{ id: 'sub-new' }], error: null }
    insertFilesResult = { error: null }
    fileRowsResult = { data: [], error: null }
    uploadResult = { error: null }
    uploadShouldDefer = false
    uploadDeferred = null
  })

  it('creates a draft submission row, inserts file rows, then marks the submission as submitted', async () => {
    const onClose = vi.fn()
    render(
      <SubmitHomeworkModal
        open onClose={onClose} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
      />
    )

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [pdfFile, jpgFile] } })
    fireEvent.click(screen.getByText('Отправить'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(insertSubmissionSpy).toHaveBeenCalledWith(expect.objectContaining({
      homework_id: 'hw-1',
      student_id: 'stud-1',
      status: 'not_submitted',
      file_url: null,
    }))
    expect(insertFilesSpy).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ submission_id: 'sub-new', position: 1, mime_type: 'application/pdf' }),
      expect.objectContaining({ submission_id: 'sub-new', position: 2, mime_type: 'image/jpeg' }),
    ]))
    expect(updateSubmissionSpy).toHaveBeenCalledWith(expect.objectContaining({
      status: 'submitted',
      answer_text: null,
      score: null,
      checked_by: null,
      file_url: expect.stringContaining('submissions/hw-1/stud-1/'),
    }))
    expect(callOrder).toEqual([
      'submission:maybeSingle',
      'submission:insert',
      'files:select',
      'storage:upload',
      'storage:upload',
      'files:insert',
      'submission:update',
    ])
    expect(toastSuccess).toHaveBeenCalledWith('Работа отправлена на проверку')
  })

  it('when a reset not_submitted row already has old attempts, inserts the new files as the next attempt instead of reusing attempt 1', async () => {
    maybeSingleResult = { data: { id: 'sub-existing', status: 'not_submitted' }, error: null }
    fileRowsResult = { data: [{ attempt_number: 1 }, { attempt_number: 2 }], error: null }
    const onClose = vi.fn()
    render(
      <SubmitHomeworkModal
        open onClose={onClose} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
      />
    )

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [pdfFile, jpgFile] } })
    fireEvent.click(screen.getByText('Отправить'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(insertSubmissionSpy).not.toHaveBeenCalled()
    expect(insertFilesSpy).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ submission_id: 'sub-existing', position: 1, attempt_number: 3 }),
      expect.objectContaining({ submission_id: 'sub-existing', position: 2, attempt_number: 3 }),
    ]))
    expect(callOrder).toEqual([
      'submission:maybeSingle',
      'files:select',
      'storage:upload',
      'storage:upload',
      'files:insert',
      'submission:update',
    ])
    expect(toastSuccess).toHaveBeenCalledWith('Работа отправлена на проверку')
  })

  it('on resubmit keeps old file rows and inserts the new full set as the next attempt', async () => {
    maybeSingleResult = { data: { id: 'sub-existing', status: 'revision' }, error: null }
    fileRowsResult = { data: [{ attempt_number: 1 }, { attempt_number: 1 }, { attempt_number: 2 }], error: null }
    const onClose = vi.fn()
    render(
      <SubmitHomeworkModal
        open onClose={onClose} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
        isResubmit
        previousFileUrl="submissions/hw-1/stud-1/old.pdf"
        previousFilePaths={['submissions/hw-1/stud-1/old.pdf', 'submissions/hw-1/stud-1/old-2.jpg']}
        feedback="Переделай аккуратнее"
      />
    )

    expect(screen.getByText('Переделай аккуратнее')).toBeInTheDocument()
    expect(screen.getByText('Файл 1')).toBeInTheDocument()
    expect(screen.getByText('Файл 2')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [pdfFile] } })
    fireEvent.click(screen.getByText('Отправить пересдачу'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(insertSubmissionSpy).not.toHaveBeenCalled()
    expect(insertFilesSpy).toHaveBeenCalledWith([
      expect.objectContaining({ submission_id: 'sub-existing', position: 1, attempt_number: 3 }),
    ])
    expect(callOrder).toEqual([
      'submission:maybeSingle',
      'files:select',
      'storage:upload',
      'files:insert',
      'submission:update',
    ])
    expect(toastSuccess).toHaveBeenCalledWith('Работа отправлена на повторную проверку')
  })

  it('shows a clear error and does not close when the row was checked in the meantime', async () => {
    maybeSingleResult = { data: { id: 'sub-existing', status: 'revision' }, error: null }
    updateSubmissionResult = { data: [], error: null }
    const onClose = vi.fn()
    render(
      <SubmitHomeworkModal
        open onClose={onClose} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
        isResubmit previousFileUrl={null} feedback={null}
      />
    )

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [pdfFile] } })
    fireEvent.click(screen.getByText('Отправить пересдачу'))

    await waitFor(() => expect(screen.getByText('Работа уже проверена, обнови страницу')).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('rejects HEIC files before upload with a friendly message', async () => {
    render(
      <SubmitHomeworkModal
        open onClose={vi.fn()} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
      />
    )

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [heicFile] } })

    await waitFor(() => expect(screen.getByText('Сохраните как JPG или PDF')).toBeInTheDocument())
    expect(insertFilesSpy).not.toHaveBeenCalled()
  })

  it('rejects files above 10 MB and total batches above 40 MB', async () => {
    render(
      <SubmitHomeworkModal
        open onClose={vi.fn()} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
      />
    )

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [bigFile] } })
    await waitFor(() => expect(screen.getByText('Файл слишком большой. Максимум 10 МБ.')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [nineMbA, nineMbB, nineMbC, nineMbD, nineMbE] } })
    await waitFor(() => expect(screen.getByText('Суммарный размер файлов не должен превышать 40 МБ.')).toBeInTheDocument())
  })

  it('numbers files in feed order and shows a thumbnail for images but not PDFs, revoking object URLs on removal and unmount', async () => {
    const { unmount } = render(
      <SubmitHomeworkModal
        open onClose={vi.fn()} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
      />
    )

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [pdfFile, jpgFile] } })

    expect(screen.getByTestId('submit-homework-file-order-0')).toHaveTextContent('1')
    expect(screen.getByTestId('submit-homework-file-order-1')).toHaveTextContent('2')
    expect(screen.queryByTestId('submit-homework-file-thumb-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('submit-homework-file-thumb-1')).toHaveAttribute('src', 'blob:page-2.jpg')
    expect(createObjectURLSpy).toHaveBeenCalledWith(jpgFile)

    fireEvent.click(screen.getByLabelText('Удалить файл 2'))
    await waitFor(() => expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:page-2.jpg'))
    expect(screen.queryByTestId('submit-homework-file-thumb-1')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [jpgFile] } })
    await waitFor(() => expect(screen.getByTestId('submit-homework-file-thumb-1')).toBeInTheDocument())

    revokeObjectURLSpy.mockClear()
    unmount()
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:page-2.jpg')
  })

  it('shows per-file upload progress and disables the form while multiple files upload', async () => {
    uploadShouldDefer = true
    render(
      <SubmitHomeworkModal
        open onClose={vi.fn()} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
      />
    )

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [pdfFile, jpgFile] } })
    fireEvent.click(screen.getByText('Отправить'))

    await waitFor(() => expect(screen.getByTestId('submit-homework-progress')).toHaveTextContent('Загрузка 1 из 2'))
    expect(screen.getByTestId('submit-homework-submit')).toBeDisabled()
    expect(screen.getByLabelText('Удалить файл 1')).toBeDisabled()
    uploadDeferred?.({ error: null })

    await waitFor(() => expect(screen.getByTestId('submit-homework-progress')).toHaveTextContent('Загрузка 2 из 2'))
    uploadDeferred?.({ error: null })

    await waitFor(() => expect(screen.queryByTestId('submit-homework-progress')).not.toBeInTheDocument())
    expect(toastSuccess).toHaveBeenCalledWith('Работа отправлена на проверку')
  })

  it('reports which specific file failed to upload', async () => {
    uploadResult = { error: { message: 'сеть недоступна' } }
    render(
      <SubmitHomeworkModal
        open onClose={vi.fn()} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
      />
    )

    fireEvent.change(screen.getByTestId('submit-homework-file-input'), { target: { files: [pdfFile] } })
    fireEvent.click(screen.getByText('Отправить'))

    await waitFor(() => expect(screen.getByTestId('submit-homework-file-error-0')).toHaveTextContent('сеть недоступна'))
    expect(screen.getByText(/Не удалось загрузить файл.*solution\.pdf/)).toBeInTheDocument()
  })
})
