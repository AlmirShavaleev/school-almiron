import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DistributeJoinRequestWizard, type DistributeGroupOption } from '@/components/students/DistributeJoinRequestWizard'

/**
 * §150: переключателя режимов больше нет вообще -- ни у курса с группой
 * (§61/§64: она всегда одна, вторую не завести -- groups_one_per_course), ни
 * у курса без группы (реальный, но редкий край: жёсткое удаление группы
 * через «Архивировать группу» — открытый вопрос, не эта задача). Мастер
 * просто показывает состояние строкой и отправляет ровно один режим сам.
 */

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'teacher-1' } }),
}))

const getMyActiveCoursesMock = vi.fn()
const distributeStudentCoursesMock = vi.fn()
vi.mock('@/lib/joinRequestDistribution', async () => {
  const actual = await vi.importActual<typeof import('@/lib/joinRequestDistribution')>('@/lib/joinRequestDistribution')
  return {
    ...actual,
    getMyActiveCourses: (...args: unknown[]) => getMyActiveCoursesMock(...args),
    distributeStudentCourses: (...args: unknown[]) => distributeStudentCoursesMock(...args),
    distributeJoinRequest: vi.fn(),
  }
})

const course = { id: 'course-1', title: 'Физика ЕГЭ' }

const groupForCourse: DistributeGroupOption = {
  id: 'group-1',
  name: 'Физика ЕГЭ',
  courseId: 'course-1',
  isActive: true,
  maxStudents: 30,
  studentCount: 2,
  memberStudentIds: [],
  scheduleDays: null,
  scheduleTime: null,
}

function renderWizard(groups: DistributeGroupOption[]) {
  return render(
    <DistributeJoinRequestWizard
      open
      onClose={vi.fn()}
      studentId="student-1"
      studentFullName="Ученик Тестов"
      groups={groups}
      onDistributed={vi.fn()}
    />,
  )
}

describe('DistributeJoinRequestWizard — состояние группы вместо переключателя режимов', () => {
  beforeEach(() => {
    getMyActiveCoursesMock.mockReset()
    distributeStudentCoursesMock.mockReset()
    distributeStudentCoursesMock.mockResolvedValue({
      studentId: 'student-1', joinRequestId: '', teacherStudentId: '', status: 'ok', assignments: [],
    })
    getMyActiveCoursesMock.mockResolvedValue([course])
  })

  it('курс с группой: нет ни одной кнопки-переключателя, показана строка с готовой группой', async () => {
    renderWizard([groupForCourse])
    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)

    expect(screen.getByText('Группа «Физика ЕГЭ»: 2/30 — ученик будет добавлен в неё.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Индивидуально' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Существующая группа' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Новая мини-группа' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Распределить' }))
    await Promise.resolve()
    expect(distributeStudentCoursesMock).toHaveBeenCalledWith(
      'student-1',
      [{ courseId: 'course-1', mode: 'existing_group', groupId: 'group-1' }],
      expect.any(String),
    )
  })

  it('курс без группы: нет переключателя, показана строка «будет создана», уходит mode=new_group с названием курса', async () => {
    renderWizard([])
    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)

    expect(screen.getByText('У курса нет группы — она будет создана.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Индивидуально' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Новая мини-группа' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Название (необязательно)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Распределить' }))
    await Promise.resolve()
    expect(distributeStudentCoursesMock).toHaveBeenCalledWith(
      'student-1',
      [{ courseId: 'course-1', mode: 'new_group', title: 'Физика ЕГЭ', maxStudents: 30 }],
      expect.any(String),
    )
  })
})
