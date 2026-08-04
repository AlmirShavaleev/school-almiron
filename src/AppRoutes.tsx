import { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { lazyPage } from '@/lib/lazyPage'

// Layouts
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { RoleGuard } from '@/components/auth/RoleGuard'

// Dashboard
const DashboardPage = lazyPage('DashboardPage', () => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))

// Role dashboards
const StudentDashboard = lazyPage('StudentDashboard', () => import('@/pages/student/StudentDashboard').then(m => ({ default: m.StudentDashboard })))
const TeacherDashboard = lazyPage('TeacherDashboard', () => import('@/pages/teacher/TeacherDashboard').then(m => ({ default: m.TeacherDashboard })))
const CuratorDashboard = lazyPage('CuratorDashboard', () => import('@/pages/curator/CuratorDashboard').then(m => ({ default: m.CuratorDashboard })))
const AdminDashboard = lazyPage('AdminDashboard', () => import('@/pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })))
const TelegramJournalPage = lazyPage('TelegramJournalPage', () => import('@/pages/admin/TelegramJournalPage').then(m => ({ default: m.TelegramJournalPage })))
const CartPage = lazyPage('CartPage', () => import('@/pages/CartPage').then(m => ({ default: m.CartPage })))
const CollectionDetailPage = lazyPage('CollectionDetailPage', () => import('@/pages/CollectionDetailPage').then(m => ({ default: m.CollectionDetailPage })))

// Shared pages
const GroupsPage = lazyPage('GroupsPage', () => import('@/pages/GroupsPage').then(m => ({ default: m.GroupsPage })))
const GroupControlPanel = lazyPage('GroupControlPanel', () => import('@/pages/GroupControlPanel').then(m => ({ default: m.GroupControlPanel })))
const TeacherDetailPage = lazyPage('TeacherDetailPage', () => import('@/pages/TeacherDetailPage').then(m => ({ default: m.TeacherDetailPage })))
const LessonDetailPage = lazyPage('LessonDetailPage', () => import('@/pages/LessonDetailPage').then(m => ({ default: m.LessonDetailPage })))
const StudentJournalPage = lazyPage('StudentJournalPage', () => import('@/pages/StudentJournalPage').then(m => ({ default: m.StudentJournalPage })))
const HomeworkDetailPage = lazyPage('HomeworkDetailPage', () => import('@/pages/HomeworkDetailPage').then(m => ({ default: m.HomeworkDetailPage })))
const HomeworkReviewPage = lazyPage('HomeworkReviewPage', () => import('@/pages/HomeworkReviewPage').then(m => ({ default: m.HomeworkReviewPage })))
const StudentReviewPage = lazyPage('StudentReviewPage', () => import('@/pages/StudentReviewPage').then(m => ({ default: m.StudentReviewPage })))
const HomeworkQueuePage = lazyPage('HomeworkQueuePage', () => import('@/pages/HomeworkQueuePage').then(m => ({ default: m.HomeworkQueuePage })))
const LessonsPage = lazyPage('LessonsPage', () => import('@/pages/LessonsPage').then(m => ({ default: m.LessonsPage })))
const MockExamsPage = lazyPage('MockExamsPage', () => import('@/pages/MockExamsPage').then(m => ({ default: m.MockExamsPage })))
const SettingsPage = lazyPage('SettingsPage', () => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const NotificationsPage = lazyPage('NotificationsPage', () => import('@/pages/NotificationsPage').then(m => ({ default: m.NotificationsPage })))
const CourseProgramPage = lazyPage('CourseProgramPage', () => import('@/pages/CourseProgramPage').then(m => ({ default: m.CourseProgramPage })))
const LessonLibraryPage = lazyPage('LessonLibraryPage', () => import('@/pages/LessonLibraryPage').then(m => ({ default: m.LessonLibraryPage })))
const AttendancePage = lazyPage('AttendancePage', () => import('@/pages/AttendancePage').then(m => ({ default: m.AttendancePage })))
const MyCoursesPage = lazyPage('MyCoursesPage', () => import('@/pages/MyCoursesPage').then(m => ({ default: m.MyCoursesPage })))
const StudentCoursePage = lazyPage('StudentCoursePage', () => import('@/pages/StudentCoursePage').then(m => ({ default: m.StudentCoursePage })))
const TopicPage = lazyPage('TopicPage', () => import('@/pages/TopicPage').then(m => ({ default: m.TopicPage })))
const StudentProfilePage = lazyPage('StudentProfilePage', () => import('@/pages/StudentProfilePage').then(m => ({ default: m.StudentProfilePage })))
const StudentsPage = lazyPage('StudentsPage', () => import('@/pages/StudentsPage').then(m => ({ default: m.StudentsPage })))
const SchedulePage = lazyPage('SchedulePage', () => import('@/pages/SchedulePage').then(m => ({ default: m.SchedulePage })))
const MyProgressPage = lazyPage('MyProgressPage', () => import('@/pages/student/MyProgressPage').then(m => ({ default: m.MyProgressPage })))
const MyTopicHomeworkPage = lazyPage('MyTopicHomeworkPage', () => import('@/pages/student/MyTopicHomeworkPage').then(m => ({ default: m.MyTopicHomeworkPage })))
const CatalogPage = lazyPage('CatalogPage', () => import('@/pages/catalog/CatalogPage').then(m => ({ default: m.CatalogPage })))
const CatalogSectionPage = lazyPage('CatalogSectionPage', () => import('@/pages/catalog/CatalogSectionPage').then(m => ({ default: m.CatalogSectionPage })))
const CatalogTopicPage = lazyPage('CatalogTopicPage', () => import('@/pages/catalog/CatalogTopicPage').then(m => ({ default: m.CatalogTopicPage })))
const CatalogTaskPage = lazyPage('CatalogTaskPage', () => import('@/pages/catalog/CatalogTaskPage').then(m => ({ default: m.CatalogTaskPage })))
const VariantBuilderPage = lazyPage('VariantBuilderPage', () => import('@/pages/variants/VariantBuilderPage').then(m => ({ default: m.VariantBuilderPage })))
const VariantsHomePage = lazyPage('VariantsHomePage', () => import('@/pages/variants/VariantsHomePage').then(m => ({ default: m.VariantsHomePage })))
const VariantsListPage = lazyPage('VariantsListPage', () => import('@/pages/variants/VariantsListPage').then(m => ({ default: m.VariantsListPage })))
const VariantAutoBuildPage = lazyPage('VariantAutoBuildPage', () => import('@/pages/variants/VariantAutoBuildPage').then(m => ({ default: m.VariantAutoBuildPage })))
const VariantDetailPage = lazyPage('VariantDetailPage', () => import('@/pages/variants/VariantDetailPage').then(m => ({ default: m.VariantDetailPage })))
const AssignVariantPage = lazyPage('AssignVariantPage', () => import('@/pages/variants/AssignVariantPage').then(m => ({ default: m.AssignVariantPage })))
const VariantAssignmentsPage = lazyPage('VariantAssignmentsPage', () => import('@/pages/variants/VariantAssignmentsPage').then(m => ({ default: m.VariantAssignmentsPage })))
const VariantStudentWorkPage = lazyPage('VariantStudentWorkPage', () => import('@/pages/variants/VariantStudentWorkPage').then(m => ({ default: m.VariantStudentWorkPage })))
const StudentVariantsPage = lazyPage('StudentVariantsPage', () => import('@/pages/student/StudentVariantsPage').then(m => ({ default: m.StudentVariantsPage })))
const StudentVariantDetailPage = lazyPage('StudentVariantDetailPage', () => import('@/pages/student/StudentVariantDetailPage').then(m => ({ default: m.StudentVariantDetailPage })))
const StudentVariantBuildPage = lazyPage('StudentVariantBuildPage', () => import('@/pages/student/StudentVariantBuildPage').then(m => ({ default: m.StudentVariantBuildPage })))
const StudentVariantGeneratePage = lazyPage('StudentVariantGeneratePage', () => import('@/pages/student/StudentVariantGeneratePage').then(m => ({ default: m.StudentVariantGeneratePage })))
const StudentNumberStatsPage = lazyPage('StudentNumberStatsPage', () => import('@/pages/student/StudentNumberStatsPage').then(m => ({ default: m.StudentNumberStatsPage })))
const AssignHomeworkPage = lazyPage('AssignHomeworkPage', () => import('@/pages/AssignHomeworkPage').then(m => ({ default: m.AssignHomeworkPage })))
const ReviewSubmissionsPage = lazyPage('ReviewSubmissionsPage', () => import('@/pages/ReviewSubmissionsPage').then(m => ({ default: m.ReviewSubmissionsPage })))
const SubmissionDetailPage = lazyPage('SubmissionDetailPage', () => import('@/pages/SubmissionDetailPage').then(m => ({ default: m.SubmissionDetailPage })))
const MyAssignmentsPage = lazyPage('MyAssignmentsPage', () => import('@/pages/student/MyAssignmentsPage').then(m => ({ default: m.MyAssignmentsPage })))
const AssignmentDetailPage = lazyPage('AssignmentDetailPage', () => import('@/pages/student/AssignmentDetailPage').then(m => ({ default: m.AssignmentDetailPage })))
const HomeworksV2RoleRouter = lazyPage('HomeworksV2RoleRouter', () => import('@/pages/HomeworksV2RoleRouter').then(m => ({ default: m.HomeworksV2RoleRouter })))
const HomeworkReviewQueuePage = lazyPage('HomeworkReviewQueuePage', () => import('@/pages/HomeworkReviewQueuePage').then(m => ({ default: m.HomeworkReviewQueuePage })))
const HomeworkReviewV2Page = lazyPage('HomeworkReviewV2Page', () => import('@/pages/HomeworkReviewV2Page').then(m => ({ default: m.HomeworkReviewV2Page })))
const MyHomeworksV2Page = lazyPage('MyHomeworksV2Page', () => import('@/pages/student/MyHomeworksV2Page').then(m => ({ default: m.MyHomeworksV2Page })))
const HomeworkTemplateBuilderPage = lazyPage('HomeworkTemplateBuilderPage', () => import('@/pages/teacher/HomeworkTemplateBuilderPage').then(m => ({ default: m.HomeworkTemplateBuilderPage })))
const TestBankPage = lazyPage('TestBankPage', () => import('@/pages/TestBankPage').then(m => ({ default: m.TestBankPage })))
const TestBankTestPage = lazyPage('TestBankTestPage', () => import('@/pages/TestBankTestPage').then(m => ({ default: m.TestBankTestPage })))

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

        {/* Дашборды по ролям */}
        <Route path="/student" element={<RoleGuard allow={['student']}><StudentDashboard /></RoleGuard>} />
        <Route path="/teacher" element={<RoleGuard allow={['teacher','admin','owner']}><TeacherDashboard /></RoleGuard>} />
        <Route path="/curator" element={<RoleGuard allow={['curator','admin','owner']}><CuratorDashboard /></RoleGuard>} />
        <Route path="/admin" element={<RoleGuard allow={['admin','owner']}><AdminDashboard /></RoleGuard>} />
        {/* Журнал отправок Telegram. Страница существовала с 08.07, но не была
            подключена ни маршрутом, ни импортом — быстрая ссылка на неё в
            «Обзоре» панели админа вела в никуда. Содержимое не трогали: это
            зона уведомлений. */}
        <Route path="/admin/telegram" element={<RoleGuard allow={['admin','owner']}><TelegramJournalPage /></RoleGuard>} />

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
        <Route path="/variants" element={<RoleGuard allow={['teacher','curator','admin','owner']}><VariantsHomePage /></RoleGuard>} />
        <Route path="/variants/exam/:examSubject/:examType" element={<RoleGuard allow={['teacher','curator','admin','owner']}><VariantsListPage /></RoleGuard>} />
        <Route path="/variants/exam/:examSubject/:examType/auto" element={<RoleGuard allow={['teacher','admin','owner']}><VariantAutoBuildPage /></RoleGuard>} />
        <Route path="/variants/all" element={<RoleGuard allow={['teacher','curator','admin','owner']}><VariantsListPage /></RoleGuard>} />
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
