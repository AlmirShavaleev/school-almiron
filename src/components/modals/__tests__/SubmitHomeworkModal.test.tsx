import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))

const callOrder: string[] = []
const uploadSpy = vi.fn()
const deleteSpy = vi.fn()
const insertFilesSpy = vi.fn()
const insertSubmissionSpy = vi.fn()
const updateSubmissionSpy = vi.fn()

let maybeSingleResult: { data: any; error: { message: string } | null } = { data: null, error: null }
let insertSubmissionResult: { data: any; error: { message: string } | null } = { data: { id: 'sub-new' }, error: null }
let updateSubmissionResult: { data: any; error: { message: string } | null } = { data: [{ id: 'sub-new' }], error: null }
let deleteFilesResult: { error: { message: string } | null } = { error: null }
let insertFilesResult: { error: { message: string } | null } = { error: null }

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
          delete: () => {
            deleteSpy()
            callOrder.push('files:delete')
            return {
              eq: () => Promise.resolve(deleteFilesResult),
            }
          },
          insert: (payload: unknown) => {
            insertFilesSpy(payload)
            callOrder.push('files:insert')
            return Promise.resolve(insertFilesResult)
          },
          select: () => ({
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
          return Promise.resolve({ error: null })
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
    deleteSpy.mockReset()
    insertFilesSpy.mockReset()
    insertSubmissionSpy.mockReset()
    updateSubmissionSpy.mockReset()
    toastSuccess.mockReset()
    maybeSingleResult = { data: null, error: null }
    insertSubmissionResult = { data: { id: 'sub-new' }, error: null }
    updateSubmissionResult = { data: [{ id: 'sub-new' }], error: null }
    deleteFilesResult = { error: null }
    insertFilesResult = { error: null }
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
      'storage:upload',
      'storage:upload',
      'files:insert',
      'submission:update',
    ])
    expect(toastSuccess).toHaveBeenCalledWith('Работа отправлена на проверку')
  })

  it('on resubmit deletes old file rows before inserting the new full set', async () => {
    maybeSingleResult = { data: { id: 'sub-existing', status: 'revision' }, error: null }
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
    expect(deleteSpy).toHaveBeenCalled()
    expect(insertSubmissionSpy).not.toHaveBeenCalled()
    expect(callOrder).toEqual([
      'submission:maybeSingle',
      'files:delete',
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
})
