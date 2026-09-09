import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DistributeJoinRequestWizard, type DistributeGroupOption } from '@/components/students/DistributeJoinRequestWizard'

/**
 * §61/§64: один курс = одна группа, она заводится вместе с курсом. Значит
 * «Индивидуально»/«Новая мини-группа» ведут ко второй группе на курс и
 * упираются в groups_one_per_course на бэкенде (см. миграцию
 * 20260909072422). Мастер обязан сам не предлагать эти режимы, если у курса
 * уже есть группа — иначе пользователь ловит голую ошибку уникальности.
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

describe('DistributeJoinRequestWizard — режимы распределения по наличию группы у курса', () => {
  beforeEach(() => {
    getMyActiveCoursesMock.mockReset()
    distributeStudentCoursesMock.mockReset()
    getMyActiveCoursesMock.mockResolvedValue([course])
  })

  it('курс с группой: доступна только «Существующая группа», остальные режимы погашены с подписью', async () => {
    renderWizard([groupForCourse])
    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)

    const individualChip = screen.getByRole('button', { name: 'Индивидуально' })
    const newGroupChip = screen.getByRole('button', { name: 'Новая мини-группа' })
    const existingChip = screen.getByRole('button', { name: 'Существующая группа' })

    expect(individualChip).toBeDisabled()
    expect(newGroupChip).toBeDisabled()
    expect(existingChip).not.toBeDisabled()
    expect(screen.getByText('У курса уже есть группа — учеников добавляют в неё.')).toBeInTheDocument()

    // группа подставлена сама, без выбора пользователем
    expect(screen.getByRole('combobox')).toHaveValue('group-1')
  })

  it('курс без группы: доступны все три режима, по умолчанию «Индивидуально»', async () => {
    renderWizard([])
    const checkbox = await screen.findByRole('checkbox')
    fireEvent.click(checkbox)

    const individualChip = screen.getByRole('button', { name: 'Индивидуально' })
    const newGroupChip = screen.getByRole('button', { name: 'Новая мини-группа' })
    const existingChip = screen.getByRole('button', { name: 'Существующая группа' })

    expect(individualChip).not.toBeDisabled()
    expect(newGroupChip).not.toBeDisabled()
    expect(existingChip).not.toBeDisabled()
    expect(screen.queryByText('У курса уже есть группа — учеников добавляют в неё.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Индивидуально' })).toHaveClass('border-primary-500')
  })
})
