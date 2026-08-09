import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { StudentProfilePage } from '@/pages/StudentProfilePage'

const baseProfile = {
  student_id: 'student-1',
  profile_id: 'profile-1',
  full_name: 'Almir Shavaleev',
  avatar_url: null,
  email: 'almir@example.com',
  phone: null,
  target_subject: 'physics',
  target_exam: 'ege',
  target_score: 80,
  groups: [{ id: 'group-1', name: '10А', course_title: 'Физика ЕГЭ' }],
  attendance_percent: 0,
  attendance_present: 0,
  attendance_absent: 0,
  attendance_late: 0,
  hw_total: 0,
  hw_checked: 0,
  hw_avg_score: null,
  hw_completion_pct: 0,
  course_progress_pct: 0,
  mock_count: 0,
  mock_avg: null,
  homeworks: [],
  mock_results: [],
  recent_attendance: [],
}

const useStudentProfileMock = vi.fn()
vi.mock('@/hooks/useStudentProfile', () => ({
  useStudentProfile: (...args: unknown[]) => useStudentProfileMock(...args),
}))

const useStudentCourseMembershipsMock = vi.fn()
vi.mock('@/hooks/useStudentCourseMemberships', () => ({
  useStudentCourseMemberships: (...args: unknown[]) => useStudentCourseMembershipsMock(...args),
}))

vi.mock('@/hooks/useGroups', () => ({
  useGroups: () => ({ groups: [], loading: false, reload: vi.fn() }),
}))

vi.mock('@/hooks/useStudentNumberStats', () => ({
  useStudentNumberStats: () => ({ rows: [], loading: false, error: null }),
}))

// Секция анализа ходит в базу своими хуками; здесь проверяется страница, а не
// она. Заглушка — чтобы её запросы не оседали unhandled rejection'ами и не
// роняли код выхода всего прогона (урок §88.5).
vi.mock('@/components/student/StudentInsightSection', () => ({
  StudentInsightSection: ({ studentId }: { studentId: string }) => (
    <div data-testid="student-insight-section">{studentId}</div>
  ),
}))

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ profile: { role: 'teacher' } }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) }) }) },
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/students/student-1']}>
      <Routes>
        <Route path="/students/:id" element={<StudentProfilePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('StudentProfilePage enrolled courses', () => {
  it('shows real courses from group_students, not a false empty state', async () => {
    useStudentProfileMock.mockReturnValue({ data: baseProfile, loading: false })
    useStudentCourseMembershipsMock.mockReturnValue({
      courses: [{
        courseId: 'course-1',
        courseTitle: 'Физика ЕГЭ',
        courseSubject: 'physics',
        courseExamType: 'ege',
        groups: [{ groupId: 'group-1', groupName: '10А', groupType: 'individual', isActive: true }],
      }],
      loading: false,
      error: null,
      reload: vi.fn(),
    })

    renderPage()

    expect(await screen.findByText('Физика ЕГЭ')).toBeInTheDocument()
    expect(screen.queryByText('Ученик не записан ни на один курс')).not.toBeInTheDocument()
    expect(screen.getByText('Распределить')).toBeInTheDocument()
    expect(screen.queryByText('Добавить курс')).not.toBeInTheDocument()
  })

  it('shows empty state only when there are truly no course memberships', async () => {
    useStudentProfileMock.mockReturnValue({ data: { ...baseProfile, groups: [] }, loading: false })
    useStudentCourseMembershipsMock.mockReturnValue({ courses: [], loading: false, error: null, reload: vi.fn() })

    renderPage()

    expect(await screen.findByText('Ученик не записан ни на один курс')).toBeInTheDocument()
  })

  it('shows a compact summary badge when the student has multiple groups', async () => {
    useStudentProfileMock.mockReturnValue({
      data: {
        ...baseProfile,
        groups: [
          { id: 'group-1', name: '10А', course_title: 'Физика ЕГЭ' },
          { id: 'group-2', name: 'Мини-группа', course_title: 'Математика ЕГЭ' },
        ],
      },
      loading: false,
    })
    useStudentCourseMembershipsMock.mockReturnValue({ courses: [], loading: false, error: null, reload: vi.fn() })

    renderPage()

    expect(await screen.findByText(/2 курса · 2 группы/)).toBeInTheDocument()
  })
})

/**
 * Плитки на мёртвых таблицах сняты 2026-08-09 (решение оркестратора).
 * `attendance`, `homework_submissions` и `mock_exam_results` на проде пусты, и
 * нули из них читались как факт «ученик ничего не сдал». Тест держит именно
 * это: не «блок выглядит так-то», а «страница не рисует показатель, под
 * которым нет источника».
 */
describe('StudentProfilePage — снятые мёртвые показатели', () => {
  it('ни посещаемости, ни легаси-ДЗ, ни пробников на странице нет', () => {
    useStudentProfileMock.mockReturnValue({ data: baseProfile, loading: false })
    useStudentCourseMembershipsMock.mockReturnValue({ courses: [], loading: false, error: null, reload: vi.fn() })

    renderPage()

    expect(screen.queryByText(/Посещаемость/)).not.toBeInTheDocument()
    expect(screen.queryByText('ДЗ сдано')).not.toBeInTheDocument()
    expect(screen.queryByText('Средний балл ДЗ')).not.toBeInTheDocument()
    expect(screen.queryByText(/Пробник/)).not.toBeInTheDocument()
    expect(screen.queryByText('Домашние задания')).not.toBeInTheDocument()
  })

  it('вместо них — секция анализа на живом контуре', () => {
    useStudentProfileMock.mockReturnValue({ data: baseProfile, loading: false })
    useStudentCourseMembershipsMock.mockReturnValue({ courses: [], loading: false, error: null, reload: vi.fn() })

    renderPage()

    expect(screen.getByTestId('student-insight-section')).toHaveTextContent('student-1')
  })
})
