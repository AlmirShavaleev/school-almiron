import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }))
vi.mock('@/store/toastStore', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))

let upsertResult: { data: unknown; error: { message: string } | null } = { data: [{ id: 'sub-1' }], error: null }
const upsertSpy = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'homework_submissions') {
        return {
          upsert: (payload: unknown, opts: unknown) => {
            upsertSpy(payload, opts)
            return { select: () => Promise.resolve(upsertResult) }
          },
        }
      }
      return {}
    },
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }) }) },
  },
}))

import { SubmitHomeworkModal } from '@/components/modals/SubmitHomeworkModal'

const homework = { id: 'hw-1', title: 'ДЗ', max_score: 100 }

describe('SubmitHomeworkModal — resubmission after revision', () => {
  beforeEach(() => {
    upsertSpy.mockReset()
    toastSuccess.mockReset()
    upsertResult = { data: [{ id: 'sub-1' }], error: null }
  })

  it('prefills the previous answer, shows teacher feedback, and resets score/checked_by on resubmit', async () => {
    const onClose = vi.fn()
    const onSubmitted = vi.fn()
    render(
      <SubmitHomeworkModal
        open onClose={onClose} onSubmitted={onSubmitted}
        homework={homework} studentId="stud-1"
        isResubmit previousAnswer="старый ответ" previousFileUrl={null}
        feedback="Нужно переделать формулу"
      />
    )

    expect(screen.getByText('Пересдать задание')).toBeInTheDocument()
    expect(screen.getByText('Нужно переделать формулу')).toBeInTheDocument()
    expect(screen.getByDisplayValue('старый ответ')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Отправить пересдачу'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSubmitted).toHaveBeenCalled()
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'submitted', score: null, checked_by: null }),
      { onConflict: 'homework_id,student_id' },
    )
    expect(upsertSpy.mock.calls[0][0]).not.toHaveProperty('feedback')
    expect(toastSuccess).toHaveBeenCalledWith('Работа отправлена на повторную проверку')
  })

  it('shows a clear error and does not close when the row was checked in the meantime (RLS silently filtered the row out)', async () => {
    upsertResult = { data: [], error: null }
    const onClose = vi.fn()
    render(
      <SubmitHomeworkModal
        open onClose={onClose} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
        isResubmit previousAnswer="старый ответ" previousFileUrl={null} feedback={null}
      />
    )

    fireEvent.click(screen.getByText('Отправить пересдачу'))

    await waitFor(() => expect(screen.getByText('Работа уже проверена, обнови страницу')).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('shows the regular success toast for a first-time (non-resubmit) submission', async () => {
    const onClose = vi.fn()
    render(
      <SubmitHomeworkModal
        open onClose={onClose} onSubmitted={vi.fn()}
        homework={homework} studentId="stud-1"
      />
    )

    fireEvent.change(screen.getByPlaceholderText(/Введите ответ/), { target: { value: 'мой ответ' } })
    fireEvent.click(screen.getByText('Отправить'))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toastSuccess).toHaveBeenCalledWith('Работа отправлена на проверку')
  })
})
