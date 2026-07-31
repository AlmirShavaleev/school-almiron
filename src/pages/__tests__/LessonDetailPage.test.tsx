import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const fromSpy = vi.fn()
const rpcSpy = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

function makeChain(
  getLoadResult: () => { data: unknown; error: { message: string } | null },
  getUpdateResult?: () => { data: unknown; error: { message: string } | null },
) {
  let isUpdate = false
  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'update') {
        return () => {
          isUpdate = true
          return chain
        }
      }
      if (prop === 'then') {
        const p = Promise.resolve(isUpdate && getUpdateResult ? getUpdateResult() : getLoadResult())
        return p.then.bind(p)
      }
      return () => chain
    },
  })
  return chain
}

let lessonUpdateResult: { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromSpy(...args),
    rpc: (...args: unknown[]) => rpcSpy(...args),
  },
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { profile: { id: string; role: string } }) => unknown) =>
    selector({ profile: { id: 'profile-1', role: 'teacher' } }),
}))

vi.mock('@/store/toastStore', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/components/ui/Button', () => ({
  Button: ({ children, loading, ...props }: any) => <button {...props}>{loading ? 'loading' : children}</button>,
}))
vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/ui/SignedFileLink', () => ({ SignedFileLink: ({ children }: any) => <div>{children}</div> }))
vi.mock('@/components/modals/EditLessonModal', () => ({ EditLessonModal: () => null }))
vi.mock('@/components/lessons/LessonSummaryCard', () => ({ LessonSummaryCard: () => <div>summary</div> }))
vi.mock('@/components/lessons/LessonMaterialsCard', () => ({ LessonMaterialsCard: () => <div>materials</div> }))

import { LessonDetailPage } from '@/pages/LessonDetailPage'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/lessons/lesson-1']}>
      <Routes>
        <Route path="/lessons" element={<div>lessons list</div>} />
        <Route path="/lessons/:id" element={<LessonDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LessonDetailPage critical save guards', () => {
  beforeEach(() => {
    fromSpy.mockReset()
    rpcSpy.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
    lessonUpdateResult = { data: null, error: null }

    fromSpy.mockImplementation((table: string) => {
      if (table === 'lessons') {
        return makeChain(() => ({
          data: {
            id: 'lesson-1',
            group_id: null,
            student_id: null,
            topic_id: null,
            teacher_id: 'teacher-1',
            title: 'Алгебра',
            scheduled_at: '2026-07-01T10:00:00Z',
            duration_minutes: 60,
            status: 'scheduled',
            format: 'individual',
            zoom_link: null,
            recording_url: null,
            notes: 'Старые заметки',
            created_at: '2026-07-01T09:00:00Z',
            groups: null,
            student: null,
            teachers: null,
            topics: null,
          },
          error: null,
        }), () => ({
          data: lessonUpdateResult.data,
          error: lessonUpdateResult.error,
        }))
      }
      if (table === 'attendance') return makeChain(() => ({ data: [], error: null }))
      if (table === 'homeworks') return makeChain(() => ({ data: [], error: null }))
      return makeChain(() => ({ data: [], error: null }))
    })

    rpcSpy.mockResolvedValue({ data: { allowed: true, reason: null }, error: null })
  })

  it('does not close notes editor or show success when note update returns no row', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Заметки урока')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Редактировать'))
    fireEvent.change(screen.getByPlaceholderText('Что разобрали на уроке, важные тезисы, проблемные места…'), {
      target: { value: 'Новые заметки' },
    })
    fireEvent.click(screen.getByText('Сохранить'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Заметки не были сохранены'))
    expect(screen.getByDisplayValue('Новые заметки')).toBeInTheDocument()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('does not mark lesson completed when update returns no row', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByText('Завершить')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Завершить'))
    await waitFor(() => expect(screen.getAllByText('Завершить').length).toBeGreaterThan(1))
    fireEvent.click(screen.getAllByText('Завершить')[1])

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Ошибка: Занятие не было отмечено завершённым'))
    expect(toastSuccess).not.toHaveBeenCalledWith('Занятие отмечено завершённым')
  })
})
