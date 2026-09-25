import { Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { lazyPage } from '@/lib/lazyPage'
import { LoadingGate } from '@/components/shared/LoadingGate'

// Layouts
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { RoleGuard } from '@/components/auth/RoleGuard'
import { SchoolPresencePublisher } from '@/components/admin/SchoolPresencePublisher'
import { CatalogAttachMode } from '@/components/catalog/CatalogAttachMode'
import { PreviewStubGate } from '@/components/layout/StudentPreviewUnavailable'

// Dashboard
const DashboardPage = lazyPage('DashboardPage', () => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })))

// Role dashboards
const StudentDashboard = lazyPage('StudentDashboard', () => import('@/pages/student/StudentDashboard').then(m => ({ default: m.StudentDashboard })))
const TeacherDashboard = lazyPage('TeacherDashboard', () => import('@/pages/teacher/TeacherDashboard').then(m => ({ default: m.TeacherDashboard })))
const AdminDashboard = lazyPage('AdminDashboard', () => import('@/pages/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })))
const TelegramJournalPage = lazyPage('TelegramJournalPage', () => import('@/pages/admin/TelegramJournalPage').then(m => ({ default: m.TelegramJournalPage })))
const SupportRequestsPage = lazyPage('SupportRequestsPage', () => import('@/pages/admin/SupportRequestsPage').then(m => ({ default: m.SupportRequestsPage })))
const CartPage = lazyPage('CartPage', () => import('@/pages/CartPage').then(m => ({ default: m.CartPage })))
const CollectionsPage = lazyPage('CollectionsPage', () => import('@/pages/CollectionsPage').then(m => ({ default: m.CollectionsPage })))
const CollectionDetailPage = lazyPage('CollectionDetailPage', () => import('@/pages/CollectionDetailPage').then(m => ({ default: m.CollectionDetailPage })))

// Shared pages
const GroupsPage = lazyPage('GroupsPage', () => import('@/pages/GroupsPage').then(m => ({ default: m.GroupsPage })))
const GroupControlPanel = lazyPage('GroupControlPanel', () => import('@/pages/GroupControlPanel').then(m => ({ default: m.GroupControlPanel })))
const TeacherDetailPage = lazyPage('TeacherDetailPage', () => import('@/pages/TeacherDetailPage').then(m => ({ default: m.TeacherDetailPage })))
const LessonDetailPage = lazyPage('LessonDetailPage', () => import('@/pages/LessonDetailPage').then(m => ({ default: m.LessonDetailPage })))
const StudentJournalPage = lazyPage('StudentJournalPage', () => import('@/pages/StudentJournalPage').then(m => ({ default: m.StudentJournalPage })))
const MockExamsPage = lazyPage('MockExamsPage', () => import('@/pages/MockExamsPage').then(m => ({ default: m.MockExamsPage })))
const MockExamGridPage = lazyPage('MockExamGridPage', () => import('@/pages/MockExamGridPage').then(m => ({ default: m.MockExamGridPage })))
const MockExamTemplatesPage = lazyPage('MockExamTemplatesPage', () => import('@/pages/MockExamTemplatesPage').then(m => ({ default: m.MockExamTemplatesPage })))
const SettingsPage = lazyPage('SettingsPage', () => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })))
const NotificationsPage = lazyPage('NotificationsPage', () => import('@/pages/NotificationsPage').then(m => ({ default: m.NotificationsPage })))
const CourseProgramPage = lazyPage('CourseProgramPage', () => import('@/pages/CourseProgramPage').then(m => ({ default: m.CourseProgramPage })))
const LessonLibraryPage = lazyPage('LessonLibraryPage', () => import('@/pages/LessonLibraryPage').then(m => ({ default: m.LessonLibraryPage })))
const MyCoursesPage = lazyPage('MyCoursesPage', () => import('@/pages/MyCoursesPage').then(m => ({ default: m.MyCoursesPage })))
const StudentCoursePage = lazyPage('StudentCoursePage', () => import('@/pages/StudentCoursePage').then(m => ({ default: m.StudentCoursePage })))
const TopicPage = lazyPage('TopicPage', () => import('@/pages/TopicPage').then(m => ({ default: m.TopicPage })))
const StudentProfilePage = lazyPage('StudentProfilePage', () => import('@/pages/StudentProfilePage').then(m => ({ default: m.StudentProfilePage })))
const StudentsPage = lazyPage('StudentsPage', () => import('@/pages/StudentsPage').then(m => ({ default: m.StudentsPage })))
const MyProgressPage = lazyPage('MyProgressPage', () => import('@/pages/student/MyProgressPage').then(m => ({ default: m.MyProgressPage })))
const MyTopicHomeworkPage = lazyPage('MyTopicHomeworkPage', () => import('@/pages/student/MyTopicHomeworkPage').then(m => ({ default: m.MyTopicHomeworkPage })))
const CatalogPage = lazyPage('CatalogPage', () => import('@/pages/catalog/CatalogPage').then(m => ({ default: m.CatalogPage })))
const CatalogSectionPage = lazyPage('CatalogSectionPage', () => import('@/pages/catalog/CatalogSectionPage').then(m => ({ default: m.CatalogSectionPage })))
const CatalogTopicPage = lazyPage('CatalogTopicPage', () => import('@/pages/catalog/CatalogTopicPage').then(m => ({ default: m.CatalogTopicPage })))
const CatalogTaskPage = lazyPage('CatalogTaskPage', () => import('@/pages/catalog/CatalogTaskPage').then(m => ({ default: m.CatalogTaskPage })))
const CatalogAssetsPage = lazyPage('CatalogAssetsPage', () => import('@/pages/catalog/CatalogAssetsPage').then(m => ({ default: m.CatalogAssetsPage })))
const VariantBuilderPage = lazyPage('VariantBuilderPage', () => import('@/pages/variants/VariantBuilderPage').then(m => ({ default: m.VariantBuilderPage })))
const VariantsHomePage = lazyPage('VariantsHomePage', () => import('@/pages/variants/VariantsHomePage').then(m => ({ default: m.VariantsHomePage })))
const VariantsListPage = lazyPage('VariantsListPage', () => import('@/pages/variants/VariantsListPage').then(m => ({ default: m.VariantsListPage })))
const VariantAutoBuildPage = lazyPage('VariantAutoBuildPage', () => import('@/pages/variants/VariantAutoBuildPage').then(m => ({ default: m.VariantAutoBuildPage })))
const VariantDetailPage = lazyPage('VariantDetailPage', () => import('@/pages/variants/VariantDetailPage').then(m => ({ default: m.VariantDetailPage })))
const AssignVariantPage = lazyPage('AssignVariantPage', () => import('@/pages/variants/AssignVariantPage').then(m => ({ default: m.AssignVariantPage })))
const VariantAssignmentsPage = lazyPage('VariantAssignmentsPage', () => import('@/pages/variants/VariantAssignmentsPage').then(m => ({ default: m.VariantAssignmentsPage })))
const VariantStudentWorkPage = lazyPage('VariantStudentWorkPage', () => import('@/pages/variants/VariantStudentWorkPage').then(m => ({ default: m.VariantStudentWorkPage })))
const CourseTopicTestsPage = lazyPage('CourseTopicTestsPage', () => import('@/pages/variants/CourseTopicTestsPage').then(m => ({ default: m.CourseTopicTestsPage })))
const StudyPlanPage = lazyPage('StudyPlanPage', () => import('@/pages/StudyPlanPage').then(m => ({ default: m.StudyPlanPage })))
const StudentVariantsPage = lazyPage('StudentVariantsPage', () => import('@/pages/student/StudentVariantsPage').then(m => ({ default: m.StudentVariantsPage })))
const StudentVariantDetailPage = lazyPage('StudentVariantDetailPage', () => import('@/pages/student/StudentVariantDetailPage').then(m => ({ default: m.StudentVariantDetailPage })))
const StudentVariantBuildPage = lazyPage('StudentVariantBuildPage', () => import('@/pages/student/StudentVariantBuildPage').then(m => ({ default: m.StudentVariantBuildPage })))
const StudentVariantGeneratePage = lazyPage('StudentVariantGeneratePage', () => import('@/pages/student/StudentVariantGeneratePage').then(m => ({ default: m.StudentVariantGeneratePage })))
const StudentNumberStatsPage = lazyPage('StudentNumberStatsPage', () => import('@/pages/student/StudentNumberStatsPage').then(m => ({ default: m.StudentNumberStatsPage })))
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
  // С пределом по времени: чанк страницы может не доехать (обрыв связи,
  // деплой посреди сессии), и тогда пользователь останется со спиннером
  // навсегда. См. `LoadingGate`.
  return <LoadingGate label="страница кабинета" />
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
    <>
    {/* Присутствие в школе. Публикуют ВСЕ вошедшие — ученик, преподаватель,
        куратор, админ; читает список только админ (политика
        `school_presence_read`). Смонтировать это на экране панели было бы
        недостаточно: «кто сейчас на платформе» показывал бы одних админов, то
        есть отвечал бы не на тот вопрос, ради которого панель открывают.

        В канал уходят только `profileId` и роль: ни имени, ни адреса
        страницы, ни идентификатора темы — «на каком экране находится
        ребёнок» владелец запретил показывать, и здесь этого нет в передаче, а
        не спрятано на экране.

        Стоит ВЫШЕ <Suspense> и рисует null: не загрузившаяся страница не
        должна задерживать отметку присутствия, а отказ канала не должен
        задерживать страницу. Тот же довод, что у счётчиков в App.tsx
        (§131/§143). Гость ничего не публикует — хук молчит без профиля. */}
    <SchoolPresencePublisher />
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      {/* Protected — dashboard layout */}
      <Route element={<DashboardLayout />}>
        {/* Доступно всем авторизованным */}
        <Route path="/dashboard" element={<DashboardPage />} />
        {/* В предпросмотре глазами ученика (§178) — заглушка: уведомления у
            владельца свои, показывать их под ярлыком «Ученик» было бы обманом. */}
        <Route path="/notifications" element={<PreviewStubGate><NotificationsPage /></PreviewStubGate>} />
        <Route path="/settings" element={<SettingsPage />} />

        {/* Дашборды по ролям */}
        <Route path="/student" element={<RoleGuard allow={['student']} preview="stub"><StudentDashboard /></RoleGuard>} />
        <Route path="/teacher" element={<RoleGuard allow={['teacher','admin','owner']}><TeacherDashboard /></RoleGuard>} />
        {/* Маршрута /curator больше нет (снесён 2026-08-05 по решению
            владельца). «Кабинет куратора» стоял на легаси-механике —
            таблице `curators`, слоте `groups.curator_id` и мёртвом контуре
            `homeworks`/`homework_submissions` (0 строк), — то есть не мог
            показать ничего даже единственному профилю с ролью curator.
            Новое кураторство живёт в `course_curators` и входа в отдельный
            кабинет не имеет: куратор работает на общих страницах проверки
            ДЗ, программы и учеников. Страница CuratorDashboard.tsx лежала на
            диске без роута и удалена в §185 вместе со старым контуром ДЗ. */}
        <Route path="/admin" element={<RoleGuard allow={['admin','owner']}><AdminDashboard /></RoleGuard>} />
        {/* Журнал отправок Telegram. Страница существовала с 08.07, но не была
            подключена ни маршрутом, ни импортом — быстрая ссылка на неё в
            «Обзоре» панели админа вела в никуда. Содержимое не трогали: это
            зона уведомлений. */}
        <Route path="/admin/telegram" element={<RoleGuard allow={['admin','owner']}><TelegramJournalPage /></RoleGuard>} />
        {/* Обращения «Сообщить о проблеме» (§57). Экрана со списком не было до
            §169: статус `new` снять было негде, и обращения лежали месяцами.
            Сюда ведёт строка «Разобрать обращения» на «Обзоре». */}
        <Route path="/admin/support" element={<RoleGuard allow={['admin','owner']}><SupportRequestsPage /></RoleGuard>} />

        {/* Только персонал (teacher/curator/admin/owner) */}
        <Route path="/groups" element={<RoleGuard allow={['teacher','curator','admin','owner']}><GroupsPage /></RoleGuard>} />
        <Route path="/groups/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><GroupControlPanel /></RoleGuard>} />
        <Route path="/students" element={<RoleGuard allow={['teacher','curator','admin','owner']} allowCourseCurator><StudentsPage /></RoleGuard>} />
        <Route path="/teachers/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><TeacherDetailPage /></RoleGuard>} />
        <Route path="/students/:id" element={<RoleGuard allow={['teacher','curator','admin','owner']}><StudentProfilePage /></RoleGuard>} />
        <Route path="/students/:studentId/journal" element={<RoleGuard allow={['teacher','admin','owner']}><StudentJournalPage /></RoleGuard>} />
        <Route path="/course-program" element={<RoleGuard allow={['teacher','curator','admin','owner']} allowCourseCurator><CourseProgramPage /></RoleGuard>} />
        <Route path="/course-program/:courseId/topic-tests" element={<RoleGuard allow={['teacher','admin','owner']}><CourseTopicTestsPage /></RoleGuard>} />
        <Route path="/course-program/:courseId/plan" element={<RoleGuard allow={['teacher','curator','admin','owner']} allowCourseCurator><StudyPlanPage /></RoleGuard>} />
        <Route path="/lesson-library" element={<RoleGuard allow={['teacher','admin','owner']}><LessonLibraryPage /></RoleGuard>} />
        {/* Маршрута `/inbox` («Очередь задач») больше нет: §197 снял контур
            «Этапа 4» — выдачу подборок как работ. Очередь показывала строки
            `task_collection` (0 в базе) и вела на `/review-submissions`, куда
            никто не ходил. Живая очередь проверки одна — `/homework-queue`. */}
        <Route path="/lessons/:id" element={<RoleGuard allow={['teacher','curator','admin','owner','student']}><LessonDetailPage /></RoleGuard>} />
        {/* Маршруты `/homeworks/:id`, `/homeworks/:id/review[/…]` сняты в §185
            вместе со старым контуром ДЗ (`homeworks`, `homework_submissions`,
            0 строк): карточка ДЗ, список проверки и разбор работы ученика
            читали только эти таблицы и показывали пустоту. Всё, что живёт, —
            в `topic_homework*` и на `/homework-queue`. */}

        {/* Занятия, расписание и посещаемость сняты 2026-08-08: владелец ведёт
            занятия вне платформы, таблицы `lessons` и `attendance` пусты по
            построению. Маршрут `/lessons/:id` ОСТАВЛЕН — на него ссылаются
            шесть мест в других зонах (поток занятий группы, журнал ученика,
            прогресс, карточка ДЗ, страница преподавателя, корзина).
            Компоненты и данные не тронуты, вернуть можно из истории.

            Списки, общие для student (своё) и персонала */}
        {/* Homework v2 — canonical routes. Role-branched at /homeworks; /my-homeworks and
            /homework-review are direct aliases to the same two pages. */}
        <Route path="/homeworks" element={<HomeworksV2RoleRouter />} />
        <Route path="/homework-review" element={<RoleGuard allow={['teacher','curator','admin','owner']}><HomeworkReviewV2Page /></RoleGuard>} />
        <Route path="/homework-templates/new" element={<RoleGuard allow={['teacher','admin','owner']}><HomeworkTemplateBuilderPage /></RoleGuard>} />
        <Route path="/my-homeworks" element={<RoleGuard allow={['student']} preview="stub"><MyHomeworksV2Page /></RoleGuard>} />
        <Route path="/mock-exams" element={<MockExamsPage />} />
        {/* §218. Таблица по номерам заданий и шаблоны. Статический сегмент
            `templates` бьёт динамический `:id` по рангу маршрута. Ученику —
            нет: читать результаты пробников ему не дают и права в базе. */}
        <Route path="/mock-exams/templates" element={<RoleGuard allow={['teacher','admin','owner']}><MockExamTemplatesPage /></RoleGuard>} />
        <Route path="/mock-exams/:id" element={<RoleGuard allow={['teacher','admin','owner']}><MockExamGridPage /></RoleGuard>} />

        {/* Обёртка каталога — режим подбора задач к уроку (§164). Вне режима не
            рисует ничего; страницы каталога о нём не знают. */}
        <Route element={<CatalogAttachMode />}>
          <Route path="/catalog" element={<RoleGuard allow={['student','teacher','curator','admin','owner']}><CatalogPage /></RoleGuard>} />
          <Route path="/catalog/:sectionId" element={<RoleGuard allow={['student','teacher','curator','admin','owner']}><CatalogSectionPage /></RoleGuard>} />
          <Route path="/catalog/:sectionId/topic/:topicId" element={<RoleGuard allow={['student','teacher','curator','admin','owner']}><CatalogTopicPage /></RoleGuard>} />
          <Route path="/catalog/task/:taskId" element={<RoleGuard allow={['student','teacher','curator','admin','owner']}><CatalogTaskPage /></RoleGuard>} />
        </Route>

        {/* Заливка картинок каталога в бакет (§195). Вне обёртки режима подбора
            задач: к уроку здесь прикреплять нечего. Права — как у политики
            бакета `catalog_assets_admin_write` (`is_admin_or_owner()`): пускать
            преподавателя на экран, где каждая кнопка упрётся в отказ Storage,
            значит врать ему про его права. Статический сегмент `assets` бьёт
            динамический `:sectionId` по рангу маршрута, порядок объявления на
            это не влияет. */}
        <Route path="/catalog/assets" element={<RoleGuard allow={['admin','owner']}><CatalogAssetsPage /></RoleGuard>} />

        <Route path="/cart" element={<RoleGuard allow={['student','teacher','admin','owner']}><CartPage /></RoleGuard>} />
        {/* Права списка ровно те же, что у карточки подборки: куратор карточку
            не открывает — значит, и списка ему не видно (§188). */}
        <Route path="/collections" element={<RoleGuard allow={['teacher','admin','owner']}><CollectionsPage /></RoleGuard>} />
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
        {/* Варианты ученика в предпросмотре (§178) — заглушка: выдачи и
            попытки личные; конструктор тоже, иначе под ярлыком «Ученик» он
            сохранял бы вариант персонала. */}
        <Route path="/student/variants" element={<RoleGuard allow={['student']} preview="stub"><StudentVariantsPage /></RoleGuard>} />
        {/* Конструктор один на всех (§128): у персонала он сохраняет обычный
            вариант в «Тесты», у ученика — самоназначение на прохождение. */}
        <Route path="/student/variants/generate" element={<RoleGuard allow={['student','teacher','curator','admin','owner']} preview="stub"><StudentVariantGeneratePage /></RoleGuard>} />
        <Route path="/student/variants/build" element={<RoleGuard allow={['student']} preview="stub"><StudentVariantBuildPage /></RoleGuard>} />
        <Route path="/student/variants/stats" element={<RoleGuard allow={['student']} preview="stub"><StudentNumberStatsPage /></RoleGuard>} />
        <Route path="/student/variants/:assignmentId" element={<RoleGuard allow={['student']} preview="stub"><StudentVariantDetailPage /></RoleGuard>} />

        {/* Общая очередь проверки PDF-ДЗ нового контура */}
        <Route path="/homework-queue" element={<RoleGuard allow={['teacher','curator','admin','owner']} allowCourseCurator><HomeworkReviewQueuePage /></RoleGuard>} />

        {/* Банк тестов */}
        <Route path="/tests" element={<RoleGuard allow={['teacher','curator','admin','owner']}><TestBankPage /></RoleGuard>} />
        <Route path="/tests/:testId" element={<RoleGuard allow={['teacher','curator','admin','owner']}><TestBankTestPage /></RoleGuard>} />

        {/* Маршруты «Этапа 4» (`/assign-homework`, `/review-submissions[/:id]`,
            `/my-assignments[/:id]`) сняты в §197 вместе с выдачей подборки как
            работы: `assigned_collections`, `assigned_collection_members` и
            `task_submissions` пусты, а сам сценарий дублировал ДЗ темы. Подборки
            остались — их собирают в каталоге, печатают и хранят в «Моих
            подборках» (`/collections`, §188). */}

        {/* Только ученик — и admin/owner в предпросмотре «глазами ученика»
            (§178): три страницы курса читают программу и материалы, которые
            персоналу и так отдаёт RLS, личное показывают пустым и не пишут. */}
        <Route path="/my-course" element={<RoleGuard allow={['student']} preview="allow"><MyCoursesPage /></RoleGuard>} />
        <Route path="/my-course/:groupId" element={<RoleGuard allow={['student']} preview="allow"><StudentCoursePage /></RoleGuard>} />
        <Route path="/my-course/:groupId/topic/:topicId" element={<RoleGuard allow={['student']} preview="allow"><TopicPage /></RoleGuard>} />
        {/* Новый контур ДЗ. Не путать с /my-homeworks (Homework V2, скрыт).
            В предпросмотре — заглушка: здесь личные работы ученика. */}
        <Route path="/my-homework" element={<RoleGuard allow={['student']} preview="stub"><MyTopicHomeworkPage /></RoleGuard>} />
        <Route path="/my-progress" element={<RoleGuard allow={['student']} preview="stub"><MyProgressPage /></RoleGuard>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </>
  )
}
