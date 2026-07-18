import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const { toastSuccessSpy, toastErrorSpy } = vi.hoisted(() => ({
  toastSuccessSpy: vi.fn(),
  toastErrorSpy: vi.fn(),
}))
const fetchSpy = vi.fn()

vi.stubGlobal('fetch', fetchSpy)

vi.mock('@/hooks/useLessonLibrary', () => ({
  useLessonTemplates: () => ({
    templates: [
      {
        id: 'tpl-1',
        title: 'Урок 1',
        description: 'Описание',
        subject: 'physics',
        exam_type: 'ege',
      },
    ],
    loading: false,
    error: null,
  }),
}))

vi.mock('@/store/toastStore', () => ({
  toast: {
    success: toastSuccessSpy,
    error: toastErrorSpy,
    info: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'token-1' } },
        error: null,
      })),
    },
  },
}))

import { AddLessonTemplateToCourseModal } from '@/components/modals/AddLessonTemplateToCourseModal'

function renderModal(groupId: string | null, groupName: string | null) {
  return render(
    <AddLessonTemplateToCourseModal
      open
      courseId="course-1"
      groupId={groupId}
      groupName={groupName}
      modules={[{ id: 'mod-1', course_id: 'course-1', title: 'Модуль 1', order_index: 0, topics: [] }]}
      defaultModuleId="mod-1"
      onCreateModule={vi.fn()}
      onClose={vi.fn()}
      onCopied={vi.fn()}
    />,
  )
}

describe('AddLessonTemplateToCourseModal', () => {
  beforeEach(() => {
    fetchSpy.mockReset()
    toastSuccessSpy.mockReset()
    toastErrorSpy.mockReset()
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, topic_id: 'topic-1' }),
    })
  })

  it('sends p_target_group_id as null when copying without a group', async () => {
    renderModal(null, null)

    fireEvent.click(screen.getByText('Урок 1'))
    fireEvent.click(screen.getByRole('button', { name: /Добавить в программу/i }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(options.body))).toMatchObject({
      template_id: 'tpl-1',
      target_course_id: 'course-1',
      target_group_id: null,
      target_module_id: 'mod-1',
    })
  })

  it('keeps sending the selected group when a group exists', async () => {
    renderModal('group-1', '10А')

    fireEvent.click(screen.getByText('Урок 1'))
    fireEvent.click(screen.getByRole('button', { name: /Добавить в программу/i }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(options.body))).toMatchObject({
      target_group_id: 'group-1',
    })
  })

  it('maps known RPC errors by substring, even with prefixed messages', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'rpc stage_lesson_copy failed: TARGET_MODULE_NOT_IN_TARGET_COURSE: denied' }),
    })

    renderModal(null, null)
    fireEvent.click(screen.getByText('Урок 1'))
    fireEvent.click(screen.getByRole('button', { name: /Добавить в программу/i }))

    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith('Выбранный модуль не принадлежит курсу'))
  })

  it('shows generic error for unknown RPC codes', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'SOMETHING_UNEXPECTED happened' }),
    })

    renderModal(null, null)
    fireEvent.click(screen.getByText('Урок 1'))
    fireEvent.click(screen.getByRole('button', { name: /Добавить в программу/i }))

    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalledWith('Не удалось скопировать урок'))
  })
})
