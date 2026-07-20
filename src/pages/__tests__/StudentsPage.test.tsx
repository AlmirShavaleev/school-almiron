import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StudentsPage } from '@/pages/StudentsPage'

const getMyStudents = vi.fn()
const getMyStudentInvites = vi.fn()
const reissueStudentInvite = vi.fn()
const reissueStudentInviteBatch = vi.fn()
const revokeStudentInvite = vi.fn()

vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({
    groups: [
      { id: 'group-1', name: '11А', course_id: 'course-1', courses: { title: 'Физика' } },
      { id: 'group-2', name: '10Б', course_id: null, courses: null },
    ],
  }),
}))

vi.mock('@/lib/studentEnrollment', () => ({
  buildInviteMessage: vi.fn((token: string, code: string) => `${token}:${code}`),
  buildInviteUrl: vi.fn((token: string) => `http://localhost:3000/join/${token}`),
  getMyStudents: (...args: unknown[]) => getMyStudents(...args),
  getMyStudentInvites: (...args: unknown[]) => getMyStudentInvites(...args),
  reissueStudentInvite: (...args: unknown[]) => reissueStudentInvite(...args),
  reissueStudentInviteBatch: (...args: unknown[]) => reissueStudentInviteBatch(...args),
  revokeStudentInvite: (...args: unknown[]) => revokeStudentInvite(...args),
}))

vi.mock('@/components/students/StudentEnrollmentModal', () => ({
  StudentEnrollmentModal: ({ open }: { open: boolean }) => open ? <div>modal-open</div> : null,
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('@/store/toastStore', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

describe('StudentsPage', () => {
  beforeEach(() => {
    getMyStudents.mockReset()
    getMyStudentInvites.mockReset()
    reissueStudentInvite.mockReset()
    reissueStudentInviteBatch.mockReset()
    revokeStudentInvite.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('loads students tab data and opens profile link', async () => {
    getMyStudents.mockResolvedValue([
      {
        studentId: 'student-1',
        profileId: 'profile-1',
        fullName: 'Иван Петров',
        classGrade: '11А',
        groups: [{ id: 'group-1', name: '11А' }],
        courses: [{ id: 'course-1', title: 'Физика' }],
        relationStatus: 'active',
        addedAt: '2026-07-19T10:00:00.000Z',
      },
    ])
    getMyStudentInvites.mockResolvedValue([])

    render(<MemoryRouter><StudentsPage /></MemoryRouter>)

    expect(await screen.findByText('Иван Петров')).toBeInTheDocument()
    expect(screen.getByText('Открыть профиль')).toHaveAttribute('href', '/students/student-1')
  })

  it('shows empty state for students', async () => {
    getMyStudents.mockResolvedValue([])
    getMyStudentInvites.mockResolvedValue([])

    render(<MemoryRouter><StudentsPage /></MemoryRouter>)

    expect(await screen.findByText('Пока нет учеников')).toBeInTheDocument()
  })

  it('shows error state and allows retry', async () => {
    getMyStudents
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([])
    getMyStudentInvites.mockResolvedValue([])

    render(<MemoryRouter><StudentsPage /></MemoryRouter>)

    expect(await screen.findByText('boom')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Повторить'))
    expect(await screen.findByText('Пока нет учеников')).toBeInTheDocument()
  })

  it('loads invites, reissues invite and enables copy actions only after reissue', async () => {
    getMyStudents.mockResolvedValue([])
    getMyStudentInvites.mockResolvedValue([
      {
        inviteId: 'invite-1',
        groupId: 'group-1',
        groupName: '11А',
        batchId: 'batch-1',
        fullName: 'Анна',
        classGrade: '11А',
        email: 'anna@example.com',
        phone: null,
        status: 'pending',
        createdAt: '2026-07-19T10:00:00.000Z',
        expiresAt: '2026-08-02T10:00:00.000Z',
      },
    ])
    reissueStudentInvite.mockResolvedValue({
      inviteId: 'invite-1',
      token: 'new-token',
      shortCode: 'NEW123',
      expiresAt: '2026-08-03T10:00:00.000Z',
    })

    render(<MemoryRouter><StudentsPage /></MemoryRouter>)
    fireEvent.click(screen.getByText('Приглашения'))

    expect(await screen.findByText('Анна')).toBeInTheDocument()
    expect(screen.queryByText('Скопировать ссылку')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Перевыпустить приглашение'))

    await waitFor(() => expect(reissueStudentInvite).toHaveBeenCalledWith('invite-1'))
    expect(await screen.findByText('Скопировать ссылку')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Скопировать ссылку'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:3000/join/new-token'))
  })

  it('revokes invite and updates local status', async () => {
    getMyStudents.mockResolvedValue([])
    getMyStudentInvites.mockResolvedValue([
      {
        inviteId: 'invite-2',
        groupId: 'group-1',
        groupName: '11А',
        batchId: null,
        fullName: 'Мария',
        classGrade: '10Б',
        email: null,
        phone: null,
        status: 'pending',
        createdAt: '2026-07-19T10:00:00.000Z',
        expiresAt: '2026-08-02T10:00:00.000Z',
      },
    ])
    revokeStudentInvite.mockResolvedValue(undefined)

    render(<MemoryRouter><StudentsPage /></MemoryRouter>)
    fireEvent.click(screen.getByText('Приглашения'))
    expect(await screen.findByText('Мария')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Отозвать приглашение'))
    await waitFor(() => expect(revokeStudentInvite).toHaveBeenCalledWith('invite-2'))
    expect((await screen.findAllByText('Отозвано')).length).toBeGreaterThan(0)
  })

  it('opens add students modal from primary button', async () => {
    getMyStudents.mockResolvedValue([])
    getMyStudentInvites.mockResolvedValue([])

    render(<MemoryRouter><StudentsPage /></MemoryRouter>)

    fireEvent.click(screen.getByText('Добавить класс'))
    expect(await screen.findByText('modal-open')).toBeInTheDocument()
  })
})
