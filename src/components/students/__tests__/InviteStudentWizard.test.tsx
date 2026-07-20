import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { InviteStudentWizard } from '@/components/students/InviteStudentWizard'

const inviteStudentFlow = vi.fn()
const countDirectionCourses = vi.fn().mockResolvedValue(0)

vi.mock('@/lib/studentEnrollment', () => ({
  COURSE_SELECTION_REQUIRED: 'COURSE_SELECTION_REQUIRED',
  buildInviteUrl: (t: string) => `http://localhost/join/${t}`,
  buildInviteMessage: (t: string, c: string) => `${t}:${c}`,
  inviteStudentFlow: (...a: unknown[]) => inviteStudentFlow(...a),
  listDirectionCourses: vi.fn(),
  countDirectionCourses: (...a: unknown[]) => countDirectionCourses(...a),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { profile: { id: string; role: string } }) => unknown) =>
    sel({ profile: { id: 'teacher-profile-1', role: 'teacher' } }),
}))

vi.mock('@/store/toastStore', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('InviteStudentWizard', () => {
  beforeEach(() => {
    inviteStudentFlow.mockReset()
    countDirectionCourses.mockClear()
  })

  it('passes a request_id and links "Наполнить программу" to the created course', async () => {
    inviteStudentFlow.mockResolvedValueOnce({
      inviteId: 'inv-1', token: 'tok-1', shortCode: 'CODE1', expiresAt: '2026-08-01T12:00:00.000Z',
      groupId: 'grp-1', courseId: 'course-xyz', courseCreated: true, groupCreated: true, draftCourse: true,
    })

    render(<MemoryRouter><InviteStudentWizard open onClose={() => {}} groups={[]} /></MemoryRouter>)

    fireEvent.change(screen.getByRole('textbox', { name: /ФИО ученика/i }) ?? screen.getAllByRole('textbox')[0], {
      target: { value: 'Иван Петров' },
    })
    fireEvent.click(screen.getByText('Создать и отправить приглашение'))

    await waitFor(() => expect(inviteStudentFlow).toHaveBeenCalledTimes(1))
    const arg = inviteStudentFlow.mock.calls[0][0]
    expect(arg.requestId).toBeTruthy()
    expect(arg.format).toBe('individual')

    const link = await screen.findByText('Наполнить программу')
    expect(link.getAttribute('href')).toContain('courseId=course-xyz')
  })

  it('reuses the same request_id when the send is retried after an error', async () => {
    inviteStudentFlow.mockRejectedValueOnce(Object.assign(new Error('network'), { code: null }))
    inviteStudentFlow.mockResolvedValueOnce({
      inviteId: 'inv-1', token: 'tok-1', shortCode: 'CODE1', expiresAt: '2026-08-01T12:00:00.000Z',
      groupId: 'grp-1', courseId: 'course-xyz', courseCreated: false, groupCreated: true, draftCourse: false,
    })

    render(<MemoryRouter><InviteStudentWizard open onClose={() => {}} groups={[]} /></MemoryRouter>)
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Иван Петров' } })

    fireEvent.click(screen.getByText('Создать и отправить приглашение'))
    await waitFor(() => expect(inviteStudentFlow).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('Создать и отправить приглашение'))
    await waitFor(() => expect(inviteStudentFlow).toHaveBeenCalledTimes(2))

    const first = inviteStudentFlow.mock.calls[0][0].requestId
    const second = inviteStudentFlow.mock.calls[1][0].requestId
    expect(first).toBe(second)
  })
})
