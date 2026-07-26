import { Routes, Route, Navigate } from 'react-router-dom'

// Layouts
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { RoleGuard } from '@/components/auth/RoleGuard'

// Dashboard
import { DashboardPage } from '@/pages/DashboardPage'

// Role dashboards
import { StudentDashboard } from '@/pages/student/StudentDashboard'
import { TeacherDashboard } from '@/pages/teacher/TeacherDashboard'
import { CuratorDashboard } from '@/pages/curator/CuratorDashboard'
import { AdminDashboard } from '@/pages/admin/AdminDashboard'
import { OwnerDashboard } from '@/pages/owner/OwnerDashboard'
import { CartPage } from '@/pages/CartPage'
import { CollectionDetailPage } from '@/pages/CollectionDetailPage'

// Shared pages
import { GroupsPage } from '@/pages/GroupsPage'
import { GroupControlPanel } from '@/pages/GroupControlPanel'
import { TeacherDetailPage } from '@/pages/TeacherDetailPage'
import { LessonDetailPage } from '@/pages/LessonDetailPage'
import { StudentJournalPage } from '@/pages/StudentJournalPage'
import { HomeworkDetailPage } from '@/pages/HomeworkDetailPage'
import { HomeworkReviewPage } from '@/pages/HomeworkReviewPage'
import { StudentReviewPage } from '@/pages/StudentReviewPage'
import { HomeworkQueuePage } from '@/pages/HomeworkQueuePage'
import { LessonsPage } from '@/pages/LessonsPage'
import { MockExamsPage } from '@/pages/MockExamsPage'
import { PaymentsPage } from '@/pages/PaymentsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { NotificationsPage } from '@/pages/NotificationsPage'
import { CourseProgramPage } from '@/pages/CourseProgramPage'
import { LessonLibraryPage } from '@/pages/LessonLibraryPage'
import { AttendancePage } from '@/pages/AttendancePage'
import { MyCoursesPage } from '@/pages/MyCoursesPage'
import { StudentCoursePage } from '@/pages/StudentCoursePage'
import { TopicPage } from '@/pages/TopicPage'
import { StudentProfilePage } from '@/pages/StudentProfilePage'
import { StudentsPage } from '@/pages/StudentsPage'
import { SchedulePage } from '@/pages/SchedulePage'
import { MyProgressPage } from '@/pages/student/MyProgressPage'
import { CatalogPage } from '@/pages/catalog/CatalogPage'
import { CatalogSectionPage } from '@/pages/catalog/CatalogSectionPage'
import { CatalogTopicPage } from '@/pages/catalog/CatalogTopicPage'
import { CatalogTaskPage } from '@/pages/catalog/CatalogTaskPage'
import { VariantBuilderPage } from '@/pages/variants/VariantBuilderPage'
import { VariantsListPage } from '@/pages/variants/VariantsListPage'
import { VariantDetailPage } from '@/pages/variants/VariantDetailPage'
import { AssignVariantPage } from '@/pages/variants/AssignVariantPage'
import { VariantAssignmentsPage } from '@/pages/variants/VariantAssignmentsPage'
import { VariantStudentWorkPage } from '@/pages/variants/VariantStudentWorkPage'
import { StudentVariantsPage } from '@/pages/student/StudentVariantsPage'
import { StudentVariantDetailPage } from '@/pages/student/StudentVariantDetailPage'
import { StudentVariantBuildPage } from '@/pages/student/StudentVariantBuildPage'
import { StudentVariantGeneratePage } from '@/pages/student/StudentVariantGeneratePage'
import { StudentNumberStatsPage } from '@/pages/student/StudentNumberStatsPage'
import { AssignHomeworkPage } from '@/pages/AssignHomeworkPage'
import { ReviewSubmissionsPage } from '@/pages/ReviewSubmissionsPage'
import { SubmissionDetailPage } from '@/pages/SubmissionDetailPage'
import { MyAssignmentsPage } from '@/pages/student/MyAssignmentsPage'
import { AssignmentDetailPage } from '@/pages/student/AssignmentDetailPage'
import { HomeworksV2RoleRouter } from '@/pages/HomeworksV2RoleRouter'
import { HomeworkReviewQueuePage } from '@/pages/HomeworkReviewQueuePage'
import { HomeworkReviewV2Page } from '@/pages/HomeworkReviewV2Page'
import { MyHomeworksV2Page } from '@/pages/student/MyHomeworksV2Page'
import { HomeworkTemplateBuilderPage } from '@/pages/teacher/HomeworkTemplateBuilderPage'
import { TestBankPage } from '@/pages/TestBankPage'
import { TestBankTestPage } from '@/pages/TestBankTestPage'

/** Защищённое поддерево роутов (всё, что раньше висело под DashboardLayout в App.tsx). Lazy-загружается целиком из App.tsx. */
export default function AppRoutes() {
  return (
    <Routes>
      {/* Protected — dashboard layout */}
      <Route element={<DashboardLayout />}>
        {/* Доступно всем авторизованным */}
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/payments" element={<PaymentsPage />} />

        {/* Дашборды по ролям */}
        <Route path="/student" element={<RoleGuard allow={['student']}><StudentDashboard /></RoleGuard>} />
        <Route path="/teacher" element={<RoleGuard allow={['teacher','admin','owner']}><TeacherDashboard /></RoleGuard>} />
        <Route path="/curator" element={<RoleGuard allow={['curator','admin','owner']}><CuratorDashboard /></RoleGuard>} />
        <Route path="/admin" element={<RoleGuard allow={['admin','owner']}><AdminDashboard /></RoleGuard>} />
        <Route path="/owner" element={<RoleGuard allow={['owner']}><OwnerDashboard /></RoleGuard>} />

        {/* Только персонал (teacher/curator/admin/owner) */}
        <Route path="/groups" element={<RoleGuard allow={['teacher','curator','admin','owner']}><GroupsPage /></RoleGuard>} />
        <Route path="/groups/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><GroupControlPanel /></RoleGuard>} />
        <Route path="/students" element={<RoleGuard allow={['teacher','curator','admin','owner']}><StudentsPage /></RoleGuard>} />
        <Route path="/teachers/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><TeacherDetailPage /></RoleGuard>} />
        <Route path="/students/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><StudentProfilePage /></RoleGuard>} />
        <Route path="/students/:studentId/journal" element={<RoleGuard allow={['teacher','admin','owner']}><StudentJournalPage /></RoleGuard>} />
        <Route path="/course-program" element={<RoleGuard allow={['teacher','admin','owner']}><CourseProgramPage /></RoleGuard>} />
        <Route path="/lesson-library" element={<RoleGuard allow={['teacher','admin','owner']}><LessonLibraryPage /></RoleGuard>} />
        <Route path="/attendance" element={<RoleGuard allow={['teacher','curator','admin','owner']}><AttendancePage /></RoleGuard>} />
        <Route path="/schedule" element={<RoleGuard allow={['teacher','curator','admin','owner']}><SchedulePage /></RoleGuard>} />
        <Route path="/inbox" element={<RoleGuard allow={['teacher','curator','admin','owner']}><HomeworkQueuePage /></RoleGuard>} />
        <Route path="/lessons/:id" element={<RoleGuard allow={['teacher','curator','admin','owner','student']}><LessonDetailPage /></RoleGuard>} />
        <Route path="/homeworks/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><HomeworkDetailPage /></RoleGuard>} />
        <Route path="/homeworks/:id/review" element={<RoleGuard allow={['teacher','curator','admin','owner']}><HomeworkReviewPage /></RoleGuard>} />
        <Route path="/homeworks/:id/review/student/:studentId" element={<RoleGuard allow={['teacher','curator','admin','owner']}><StudentReviewPage /></RoleGuard>} />
        <Route path="/homeworks/:id/review/:groupId" element={<RoleGuard allow={['teacher','curator','admin','owner']}><HomeworkReviewPage /></RoleGuard>} />
        <Route path="/homeworks/:id/review/:groupId/:studentId" element={<RoleGuard allow={['teacher','curator','admin','owner']}><StudentReviewPage /></RoleGuard>} />

        {/* Списки, общие для student (своё) и персонала */}
        <Route path="/lessons" element={<LessonsPage />} />
        {/* Homework v2 — canonical routes. Role-branched at /homeworks; /my-homeworks and
            /homework-review are direct aliases to the same two pages. */}
        <Route path="/homeworks" element={<HomeworksV2RoleRouter />} />
        <Route path="/homework-review" element={<RoleGuard allow={['teacher','curator','admin','owner']}><HomeworkReviewV2Page /></RoleGuard>} />
        <Route path="/homework-templates/new" element={<RoleGuard allow={['teacher','admin','owner']}><HomeworkTemplateBuilderPage /></RoleGuard>} />
        <Route path="/my-homeworks" element={<RoleGuard allow={['student']}><MyHomeworksV2Page /></RoleGuard>} />
        <Route path="/mock-exams" element={<MockExamsPage />} />

        <Route path="/catalog" element={<RoleGuard allow={['student','teacher','curator','admin','owner']}><CatalogPage /></RoleGuard>} />
        <Route path="/catalog/:sectionId" element={<RoleGuard allow={['student','teacher','curator','admin','owner']}><CatalogSectionPage /></RoleGuard>} />
        <Route path="/catalog/:sectionId/topic/:topicId" element={<RoleGuard allow={['student','teacher','curator','admin','owner']}><CatalogTopicPage /></RoleGuard>} />
        <Route path="/catalog/task/:taskId" element={<RoleGuard allow={['student','teacher','curator','admin','owner']}><CatalogTaskPage /></RoleGuard>} />

        <Route path="/cart" element={<RoleGuard allow={['student','teacher','admin','owner']}><CartPage /></RoleGuard>} />
        <Route path="/collections/:id" element={<RoleGuard allow={['teacher','admin','owner']}><CollectionDetailPage /></RoleGuard>} />

        <Route path="/variant-builder" element={<RoleGuard allow={['teacher','admin','owner']}><VariantBuilderPage /></RoleGuard>} />
        <Route path="/variant-builder/:variantId" element={<RoleGuard allow={['teacher','admin','owner']}><VariantBuilderPage /></RoleGuard>} />
        <Route path="/variants" element={<RoleGuard allow={['teacher','curator','admin','owner']}><VariantsListPage /></RoleGuard>} />
        <Route path="/variants/:variantId" element={<RoleGuard allow={['teacher','curator','admin','owner']}><VariantDetailPage /></RoleGuard>} />
        <Route path="/variants/:variantId/assign" element={<RoleGuard allow={['teacher','admin','owner']}><AssignVariantPage /></RoleGuard>} />
        <Route path="/variants/:variantId/assignments" element={<RoleGuard allow={['teacher','admin','owner']}><VariantAssignmentsPage /></RoleGuard>} />
        <Route path="/variants/:variantId/work/:studentAssignmentId" element={<RoleGuard allow={['teacher','admin','owner']}><VariantStudentWorkPage /></RoleGuard>} />
        <Route path="/student/variants" element={<RoleGuard allow={['student']}><StudentVariantsPage /></RoleGuard>} />
        <Route path="/student/variants/generate" element={<RoleGuard allow={['student']}><StudentVariantGeneratePage /></RoleGuard>} />
        <Route path="/student/variants/build" element={<RoleGuard allow={['student']}><StudentVariantBuildPage /></RoleGuard>} />
        <Route path="/student/variants/stats" element={<RoleGuard allow={['student']}><StudentNumberStatsPage /></RoleGuard>} />
        <Route path="/student/variants/:assignmentId" element={<RoleGuard allow={['student']}><StudentVariantDetailPage /></RoleGuard>} />

        {/* Общая очередь проверки PDF-ДЗ нового контура */}
        <Route path="/homework-queue" element={<RoleGuard allow={['teacher','admin','owner']}><HomeworkReviewQueuePage /></RoleGuard>} />

        {/* Банк тестов */}
        <Route path="/tests" element={<RoleGuard allow={['teacher','curator','admin','owner']}><TestBankPage /></RoleGuard>} />
        <Route path="/tests/:testId" element={<RoleGuard allow={['teacher','curator','admin','owner']}><TestBankTestPage /></RoleGuard>} />

        {/* Этап 4: выдача и проверка ДЗ */}
        <Route path="/assign-homework" element={<RoleGuard allow={['teacher','admin','owner']}><AssignHomeworkPage /></RoleGuard>} />
        <Route path="/review-submissions" element={<RoleGuard allow={['teacher','admin','owner']}><ReviewSubmissionsPage /></RoleGuard>} />
        <Route path="/review-submissions/:id" element={<RoleGuard allow={['teacher','admin','owner']}><SubmissionDetailPage /></RoleGuard>} />
        <Route path="/my-assignments" element={<RoleGuard allow={['student']}><MyAssignmentsPage /></RoleGuard>} />
        <Route path="/my-assignments/:id" element={<RoleGuard allow={['student']}><AssignmentDetailPage /></RoleGuard>} />

        {/* Только ученик */}
        <Route path="/my-course" element={<RoleGuard allow={['student']}><MyCoursesPage /></RoleGuard>} />
        <Route path="/my-course/:groupId" element={<RoleGuard allow={['student']}><StudentCoursePage /></RoleGuard>} />
        <Route path="/my-course/:groupId/topic/:topicId" element={<RoleGuard allow={['student']}><TopicPage /></RoleGuard>} />
        <Route path="/my-progress" element={<RoleGuard allow={['student']}><MyProgressPage /></RoleGuard>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
