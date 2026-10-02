import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StudentSubjectTargets } from '@/components/student/StudentSubjectTargets'

/**
 * §216. Цель по баллу — одна на ПРЕДМЕТ, а не одна на человека.
 * Проверки поведенческие: что видно на экране и что уходит в базу.
 */

const saveMock = vi.fn()
const targetsMock = vi.fn()
const membershipsMock = vi.fn()

vi.mock('@/hooks/useStudentSubjectTargets', () => ({
  useStudentSubjectTargets: () => targetsMock(),
}))
vi.mock('@/hooks/useStudentCourseMemberships', () => ({
  useStudentCourseMemberships: () => membershipsMock(),
}))
// §255: цель, которую ученик поставил себе сам (student_exam_goals).
const ownGoalsMock = vi.fn((_profileId?: string | null) => [] as Array<{ subject: string; goal: number; updated_at: string | null }>)
vi.mock('@/hooks/useStudentExamGoals', () => ({
  useStudentExamGoals: (profileId?: string | null) => ownGoalsMock(profileId),
}))
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { id: 'profile-teacher', role: 'teacher' } }),
}))

const PHYSICS = {
  courseId: 'c1', courseTitle: 'Физика ЕГЭ', courseSubject: 'physics', courseExamType: 'ege',
  courseActive: true, groups: [],
}
const MATH = {
  courseId: 'c2', courseTitle: 'Математика ЕГЭ', courseSubject: 'math', courseExamType: 'ege',
  courseActive: true, groups: [],
}

function setup(targets: any[], courses: any[] = [PHYSICS, MATH]) {
  targetsMock.mockReturnValue({ targets, loading: false, error: null, reload: vi.fn(), save: saveMock })
  membershipsMock.mockReturnValue({ courses, loading: false, error: null, reload: vi.fn() })
  return render(<StudentSubjectTargets studentId="student-1" profileId="profile-student-1" />)
}

beforeEach(() => {
  ownGoalsMock.mockReset()
  ownGoalsMock.mockReturnValue([])
  saveMock.mockReset()
  saveMock.mockResolvedValue(undefined)
})

describe('цели по предметам в карточке ученика', () => {
  it('строка на каждый предмет ученика, даже когда цели ещё нет', () => {
    setup([])
    expect(screen.getByTestId('student-subject-target-physics-ege')).toBeInTheDocument()
    expect(screen.getByTestId('student-subject-target-math-ege')).toBeInTheDocument()
  })

  it('у предметов цели РАЗНЫЕ — ради этого раздел и делался', () => {
    setup([
      { id: 't1', student_id: 'student-1', subject: 'physics', exam_type: 'ege', target_score: 80, updated_at: null },
      { id: 't2', student_id: 'student-1', subject: 'math', exam_type: 'ege', target_score: 70, updated_at: null },
    ])
    const physics = screen.getByLabelText('Цель по предмету Физика · ЕГЭ') as HTMLInputElement
    const math = screen.getByLabelText('Цель по предмету Математика · ЕГЭ') as HTMLInputElement
    expect(physics.value).toBe('80')
    expect(math.value).toBe('70')
  })

  it('незаданная цель — пустое поле, а не ноль', () => {
    setup([])
    const physics = screen.getByLabelText('Цель по предмету Физика · ЕГЭ') as HTMLInputElement
    expect(physics.value).toBe('')
  })

  it('введённая цель уходит в базу с предметом и типом экзамена', async () => {
    setup([])
    const physics = screen.getByLabelText('Цель по предмету Физика · ЕГЭ')
    fireEvent.change(physics, { target: { value: '85' } })
    fireEvent.blur(physics)
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith('physics', 'ege', 85, 'profile-teacher'))
  })

  it('стёртая цель — это «не задана»: в базу уходит null, а не ноль', async () => {
    setup([
      { id: 't1', student_id: 'student-1', subject: 'physics', exam_type: 'ege', target_score: 80, updated_at: null },
    ])
    const physics = screen.getByLabelText('Цель по предмету Физика · ЕГЭ')
    fireEvent.change(physics, { target: { value: '' } })
    fireEvent.blur(physics)
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith('physics', 'ege', null, 'profile-teacher'))
  })

  it('без изменений в базу не ходит вовсе', () => {
    setup([
      { id: 't1', student_id: 'student-1', subject: 'physics', exam_type: 'ege', target_score: 80, updated_at: null },
    ])
    const physics = screen.getByLabelText('Цель по предмету Физика · ЕГЭ')
    fireEvent.blur(physics)
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('цель, заведённая по предмету без курса, со страницы не пропадает', () => {
    setup(
      [{ id: 't3', student_id: 'student-1', subject: 'math', exam_type: 'oge', target_score: 5, updated_at: null }],
      [PHYSICS],
    )
    expect(screen.getByTestId('student-subject-target-math-oge')).toBeInTheDocument()
  })

  it('курсов нет — блок честно говорит, что ставить цель не к чему', () => {
    setup([], [])
    expect(screen.getByText('Курсов у ученика пока нет — цель ставить не к чему.')).toBeInTheDocument()
  })

  it('§255: учитель видит цель, которую ученик поставил себе сам, рядом со своей — и не путает их', async () => {
    ownGoalsMock.mockReturnValue([{ subject: 'math', goal: 85, updated_at: '2026-10-02T10:00:00Z' }])
    setup([{ id: 't2', student_id: 'student-1', subject: 'math', exam_type: 'ege', target_score: 70, updated_at: null }])
    expect(ownGoalsMock).toHaveBeenCalledWith('profile-student-1')
    const row = screen.getByTestId('student-subject-target-math-ege')
    expect(screen.getByTestId('student-own-goal-math')).toHaveTextContent('цель ученика — 85')
    expect(row).toContainElement(screen.getByTestId('student-own-goal-math'))
    // учительская цель — своя, в поле; ученическая её не подменяет
    expect((screen.getByLabelText('Цель по предмету Математика · ЕГЭ') as HTMLInputElement).value).toBe('70')
    expect(screen.queryByTestId('student-own-goal-physics')).toBeNull()
  })

  it('§255: цель ученика по ЕГЭ не приклеивается к строке ОГЭ того же предмета', () => {
    ownGoalsMock.mockReturnValue([{ subject: 'math', goal: 85, updated_at: null }])
    setup([], [{ ...MATH, courseExamType: 'oge' }])
    expect(screen.getByTestId('student-subject-target-math-oge')).toBeInTheDocument()
    expect(screen.queryByTestId('student-own-goal-math')).toBeNull()
  })
})
