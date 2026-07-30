import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'

// Layouts
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { RoleGuard } from '@/components/auth/RoleGuard'

// Dashboard
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))

// Role dashboards
const StudentDashboard = lazy(() => import('@/pages/student/StudentDashboard').then(m => ({ default: m.StudentDashboard })))
const TeacherDashboard = lazy(() => import('@/pages/teacher/TeacherDashboard').then(m => ({ default: m.TeacherDashboard })))
const CuratorDashboard = lazy(() => import('@/pages/curator/CuratorDashboard').then(m => ({ default: m.CuratorDashboard })))
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })))
const OwnerDashboard = lazy(() => import('@/pages/owner/OwnerDashboard').then(m => ({ default: m.OwnerDashboard })))
const CartPage = lazy(() => import('@/pages/CartPage').then(m => ({ default: m.CartPage })))
const CollectionDetailPage = lazy(() => import('@/pages/CollectionDetailPage').then(m => ({ default: m.CollectionDetailPage })))

// Shared pages
const GroupsPage = lazy(() => import('@/pages/GroupsPage').then(m => ({ default: m.GroupsPage })))
const GroupControlPanel = lazy(() => import('@/pages/GroupControlPanel').then(m => ({ default: m.GroupControlPanel })))
const TeacherDetailPage = lazy(() => import('@/pages/TeacherDetailPage').then(m => ({ default: m.TeacherDetailPage })))
const LessonDetailPage = lazy(() => import('@/pages/LessonDetailPage').then(m => ({ default: m.LessonDetailPage })))
const StudentJournalPage = lazy(() => import('@/pages/StudentJournalPage').then(m => ({ default: m.StudentJournalPage })))
const HomeworkDetailPage = lazy(() => import('@/pages/HomeworkDetailPage').then(m => ({ default: m.HomeworkDetailPage })))
const HomeworkReviewPage = lazy(() => import('@/pages/HomeworkReviewPage').then(m => ({ default: m.HomeworkReviewPage })))
const StudentReviewPage = lazy(() => import('@/pages/StudentReviewPage').then(m => ({ default: m.StudentReviewPage })))
const HomeworkQueuePage = lazy(() => import('@/pages/HomeworkQueuePage').then(m => ({ default: m.HomeworkQueuePage })))
const LessonsPage = lazy(() => import('@/pages/LessonsPage').then(m => ({ default: m.LessonsPage })))
const MockExamsPage = lazy(() => import('@/pages/MockExamsPage').then(m => ({ default: m.MockExamsPage })))
const PaymentsPage = lazy(() => import('@/pages/PaymentsPage').then(m => ({ default: m.PaymentsPage })))
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage').then(m => ({ default: m.NotificationsPage })))
const CourseProgramPage = lazy(() => import('@/pages/CourseProgramPage').then(m => ({ default: m.CourseProgramPage })))
const LessonLibraryPage = lazy(() => import('@/pages/LessonLibraryPage').then(m => ({ default: m.LessonLibraryPage })))
const AttendancePage = lazy(() => import('@/pages/AttendancePage').then(m => ({ default: m.AttendancePage })))
const MyCoursesPage = lazy(() => import('@/pages/MyCoursesPage').then(m => ({ default: m.MyCoursesPage })))
const StudentCoursePage = lazy(() => import('@/pages/StudentCoursePage').then(m => ({ default: m.StudentCoursePage })))
const TopicPage = lazy(() => import('@/pages/TopicPage').then(m => ({ default: m.TopicPage })))
const StudentProfilePage = lazy(() => import('@/pages/StudentProfilePage').then(m => ({ default: m.StudentProfilePage })))
const StudentsPage = lazy(() => import('@/pages/StudentsPage').then(m => ({ default: m.StudentsPage })))
const SchedulePage = lazy(() => import('@/pages/SchedulePage').then(m => ({ default: m.SchedulePage })))
const MyProgressPage = lazy(() => import('@/pages/student/MyProgressPage').then(m => ({ default: m.MyProgressPage })))
const MyTopicHomeworkPage = lazy(() => import('@/pages/student/MyTopicHomeworkPage').then(m => ({ default: m.MyTopicHomeworkPage })))
const CatalogPage = lazy(() => import('@/pages/catalog/CatalogPage').then(m => ({ default: m.CatalogPage })))
const CatalogSectionPage = lazy(() => import('@/pages/catalog/CatalogSectionPage').then(m => ({ default: m.CatalogSectionPage })))
const CatalogTopicPage = lazy(() => import('@/pages/catalog/CatalogTopicPage').then(m => ({ default: m.CatalogTopicPage })))
const CatalogTaskPage = lazy(() => import('@/pages/catalog/CatalogTaskPage').then(m => ({ default: m.CatalogTaskPage })))
const VariantBuilderPage = lazy(() => import('@/pages/variants/VariantBuilderPage').then(m => ({ default: m.VariantBuilderPage })))
const VariantsListPage = lazy(() => import('@/pages/variants/VariantsListPage').then(m => ({ default: m.VariantsListPage })))
const VariantDetailPage = lazy(() => import('@/pages/variants/VariantDetailPage').then(m => ({ default: m.VariantDetailPage })))
const AssignVariantPage = lazy(() => import('@/pages/variants/AssignVariantPage').then(m => ({ default: m.AssignVariantPage })))
const VariantAssignmentsPage = lazy(() => import('@/pages/variants/VariantAssignmentsPage').then(m => ({ default: m.VariantAssignmentsPage })))
const VariantStudentWorkPage = lazy(() => import('@/pages/variants/VariantStudentWorkPage').then(m => ({ default: m.VariantStudentWorkPage })))
const StudentVariantsPage = lazy(() => import('@/pages/student/StudentVariantsPage').then(m => ({ default: m.StudentVariantsPage })))
const StudentVariantDetailPage = lazy(() => import('@/pages/student/StudentVariantDetailPage').then(m => ({ default: m.StudentVariantDetailPage })))
const StudentVariantBuildPage = lazy(() => import('@/pages/student/StudentVariantBuildPage').then(m => ({ default: m.StudentVariantBuildPage })))
const StudentVariantGeneratePage = lazy(() => import('@/pages/student/StudentVariantGeneratePage').then(m => ({ default: m.StudentVariantGeneratePage })))
const StudentNumberStatsPage = lazy(() => import('@/pages/student/StudentNumberStatsPage').then(m => ({ default: m.StudentNumberStatsPage })))
const AssignHomeworkPage = lazy(() => import('@/pages/AssignHomeworkPage').then(m => ({ default: m.AssignHomeworkPage })))
const ReviewSubmissionsPage = lazy(() => import('@/pages/ReviewSubmissionsPage').then(m => ({ default: m.ReviewSubmissionsPage })))
const SubmissionDetailPage = lazy(() => import('@/pages/SubmissionDetailPage').then(m => ({ default: m.SubmissionDetailPage })))
const MyAssignmentsPage = lazy(() => import('@/pages/student/MyAssignmentsPage').then(m => ({ default: m.MyAssignmentsPage })))
const AssignmentDetailPage = lazy(() => import('@/pages/student/AssignmentDetailPage').then(m => ({ default: m.AssignmentDetailPage })))
const HomeworksV2RoleRouter = lazy(() => import('@/pages/HomeworksV2RoleRouter').then(m => ({ default: m.HomeworksV2RoleRouter })))
const HomeworkReviewQueuePage = lazy(() => import('@/pages/HomeworkReviewQueuePage').then(m => ({ default: m.HomeworkReviewQueuePage })))
const HomeworkReviewV2Page = lazy(() => import('@/pages/HomeworkReviewV2Page').then(m => ({ default: m.HomeworkReviewV2Page })))
const MyHomeworksV2Page = lazy(() => import('@/pages/student/MyHomeworksV2Page').then(m => ({ default: m.MyHomeworksV2Page })))
const HomeworkTemplateBuilderPage = lazy(() => import('@/pages/teacher/HomeworkTemplateBuilderPage').then(m => ({ default: m.HomeworkTemplateBuilderPage })))
const TestBankPage = lazy(() => import('@/pages/TestBankPage').then(m => ({ default: m.TestBankPage })))
const TestBankTestPage = lazy(() => import('@/pages/TestBankTestPage').then(m => ({ default: m.TestBankTestPage })))

/**
 * Заглушка на время подгрузки чанка страницы. Намеренно скромная и без
 * полноэкранного оверлея: каркас (сайдбар, шапка) уже отрисован
 * DashboardLayout, подменяется только содержимое.
 */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-16 text-gray-400" role="status" aria-live="polite">
      <Loader2 size={20} className="animate-spin" />
      <span className="ml-2 text-sm">Загрузка…</span>
    </div>
  )
}

/**
 * Защищённое поддерево роутов (всё, что раньше висело под DashboardLayout
 * в App.tsx). Само lazy-загружается из App.tsx, а КАЖДАЯ страница внутри —
 * своим чанком.
 *
 * Почему постранично: раньше все 60 страниц были статическими импортами и
 * собирались в один чанк AppRoutes на 3,16 МБ (757 КБ gzip). Браузер обязан
 * был скачать и разобрать его целиком, чтобы показать любую страницу — на
 * мобильном интернете это секунды до первого пикселя, независимо от того,
 * насколько быстры запросы к базе. Теперь грузится только открытая страница.
 */
export default function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
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
        <Route path="/course-program" element={<RoleGuard allow={['teacher','curator','admin','owner']}><CourseProgramPage /></RoleGuard>} />
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
        <Route path="/homework-queue" element={<RoleGuard allow={['teacher','curator','admin','owner']}><HomeworkReviewQueuePage /></RoleGuard>} />

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
        {/* Новый контур ДЗ. Не путать с /my-homeworks (Homework V2, скрыт). */}
        <Route path="/my-homework" element={<RoleGuard allow={['student']}><MyTopicHomeworkPage /></RoleGuard>} />
        <Route path="/my-progress" element={<RoleGuard allow={['student']}><MyProgressPage /></RoleGuard>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
