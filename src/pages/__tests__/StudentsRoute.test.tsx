import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet } from 'react-router-dom'

vi.mock('@/components/layout/DashboardLayout', () => ({
  DashboardLayout: () => <div><span>layout</span><Outlet /></div>,
}))

vi.mock('@/components/auth/RoleGuard', () => ({
  RoleGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/pages/StudentsPage', () => ({
  StudentsPage: () => <div>students-page-marker</div>,
}))

vi.mock('@/pages/DashboardPage', () => ({ DashboardPage: () => null }))
vi.mock('@/pages/student/StudentDashboard', () => ({ StudentDashboard: () => null }))
vi.mock('@/pages/teacher/TeacherDashboard', () => ({ TeacherDashboard: () => null }))
vi.mock('@/pages/curator/CuratorDashboard', () => ({ CuratorDashboard: () => null }))
vi.mock('@/pages/admin/AdminDashboard', () => ({ AdminDashboard: () => null }))
vi.mock('@/pages/owner/OwnerDashboard', () => ({ OwnerDashboard: () => null }))
vi.mock('@/pages/CartPage', () => ({ CartPage: () => null }))
vi.mock('@/pages/CollectionDetailPage', () => ({ CollectionDetailPage: () => null }))
vi.mock('@/pages/GroupsPage', () => ({ GroupsPage: () => null }))
vi.mock('@/pages/GroupControlPanel', () => ({ GroupControlPanel: () => null }))
vi.mock('@/pages/TeacherDetailPage', () => ({ TeacherDetailPage: () => null }))
vi.mock('@/pages/LessonDetailPage', () => ({ LessonDetailPage: () => null }))
vi.mock('@/pages/StudentJournalPage', () => ({ StudentJournalPage: () => null }))
vi.mock('@/pages/HomeworkDetailPage', () => ({ HomeworkDetailPage: () => null }))
vi.mock('@/pages/HomeworkReviewPage', () => ({ HomeworkReviewPage: () => null }))
vi.mock('@/pages/StudentReviewPage', () => ({ StudentReviewPage: () => null }))
vi.mock('@/pages/HomeworkQueuePage', () => ({ HomeworkQueuePage: () => null }))
vi.mock('@/pages/LessonsPage', () => ({ LessonsPage: () => null }))
vi.mock('@/pages/HomeworksPage', () => ({ HomeworksPage: () => null }))
vi.mock('@/pages/MockExamsPage', () => ({ MockExamsPage: () => null }))
vi.mock('@/pages/PaymentsPage', () => ({ PaymentsPage: () => null }))
vi.mock('@/pages/SettingsPage', () => ({ SettingsPage: () => null }))
vi.mock('@/pages/NotificationsPage', () => ({ NotificationsPage: () => null }))
vi.mock('@/pages/CourseProgramPage', () => ({ CourseProgramPage: () => null }))
vi.mock('@/pages/LessonLibraryPage', () => ({ LessonLibraryPage: () => null }))
vi.mock('@/pages/AttendancePage', () => ({ AttendancePage: () => null }))
vi.mock('@/pages/MyCoursesPage', () => ({ MyCoursesPage: () => null }))
vi.mock('@/pages/StudentCoursePage', () => ({ StudentCoursePage: () => null }))
vi.mock('@/pages/TopicPage', () => ({ TopicPage: () => null }))
vi.mock('@/pages/StudentProfilePage', () => ({ StudentProfilePage: () => null }))
vi.mock('@/pages/SchedulePage', () => ({ SchedulePage: () => null }))
vi.mock('@/pages/student/MyProgressPage', () => ({ MyProgressPage: () => null }))
vi.mock('@/pages/catalog/CatalogPage', () => ({ CatalogPage: () => null }))
vi.mock('@/pages/catalog/CatalogSectionPage', () => ({ CatalogSectionPage: () => null }))
vi.mock('@/pages/catalog/CatalogTopicPage', () => ({ CatalogTopicPage: () => null }))
vi.mock('@/pages/catalog/CatalogTaskPage', () => ({ CatalogTaskPage: () => null }))
vi.mock('@/pages/variants/VariantBuilderPage', () => ({ VariantBuilderPage: () => null }))
vi.mock('@/pages/variants/VariantsListPage', () => ({ VariantsListPage: () => null }))
vi.mock('@/pages/variants/VariantDetailPage', () => ({ VariantDetailPage: () => null }))
vi.mock('@/pages/variants/AssignVariantPage', () => ({ AssignVariantPage: () => null }))
vi.mock('@/pages/variants/VariantAssignmentsPage', () => ({ VariantAssignmentsPage: () => null }))
vi.mock('@/pages/variants/VariantStudentWorkPage', () => ({ VariantStudentWorkPage: () => null }))
vi.mock('@/pages/student/StudentVariantsPage', () => ({ StudentVariantsPage: () => null }))
vi.mock('@/pages/student/StudentVariantDetailPage', () => ({ StudentVariantDetailPage: () => null }))
vi.mock('@/pages/student/StudentVariantBuildPage', () => ({ StudentVariantBuildPage: () => null }))
vi.mock('@/pages/student/StudentVariantGeneratePage', () => ({ StudentVariantGeneratePage: () => null }))
vi.mock('@/pages/student/StudentNumberStatsPage', () => ({ StudentNumberStatsPage: () => null }))
vi.mock('@/pages/AssignHomeworkPage', () => ({ AssignHomeworkPage: () => null }))
vi.mock('@/pages/ReviewSubmissionsPage', () => ({ ReviewSubmissionsPage: () => null }))
vi.mock('@/pages/SubmissionDetailPage', () => ({ SubmissionDetailPage: () => null }))
vi.mock('@/pages/student/MyAssignmentsPage', () => ({ MyAssignmentsPage: () => null }))
vi.mock('@/pages/student/AssignmentDetailPage', () => ({ AssignmentDetailPage: () => null }))

import AppRoutes from '@/AppRoutes'

describe('Students route', () => {
  it('renders /students for teacher staff area', () => {
    render(
      <MemoryRouter initialEntries={['/students']}>
        <AppRoutes />
      </MemoryRouter>,
    )

    expect(screen.getByText('students-page-marker')).toBeInTheDocument()
  })
})
