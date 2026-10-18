import { Outlet, useLocation } from 'react-router-dom'
import { StaffAvatarMenu, StaffNav, StudentAvatarMenu, StudentNav } from '@/components/student/nav/StudentNav'
import { StudentBell } from '@/components/student/nav/StudentBell'
import { studentPageTitle } from '@/lib/studentNav'
// import { NotificationBell } from './NotificationBell' // скрыто на время MVP
import { ImpersonationBanner } from '@/components/demo/ImpersonationBanner'
import { SupportWidget } from '@/components/shared/SupportWidget'
import { LoadingGate } from '@/components/shared/LoadingGate'
import { TelegramOnboarding } from '@/components/shared/TelegramOnboarding'
import { useAuthStore } from '@/store/authStore'
import { ROLE_LABELS, useMobilePreview, useStaffMode } from '@/store/staffModeStore'
import { StaffModeSwitch } from './StaffModeSwitch'
import { StaffModeGate } from './StaffModeGate'
import { StudentPreviewBanner } from './StudentPreviewBanner'
import { MobilePreviewFrame } from './MobilePreviewFrame'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useWorkModeStore } from '@/store/workModeStore'
import { workModeAllows } from '@/lib/workMode'
import { WorkModeClosed, WorkModeStrip, useWorkModeSync } from './WorkMode'
import { useStudentTheme } from '@/store/studentThemeStore'
import { studentSkinPage } from '@/components/student/skin/skin'
import '@/components/student/skin/student.css'

/**
 * Заголовок в шапке. Порядок важен: берётся ПЕРВОЕ совпадение, поэтому
 * частные маршруты стоят выше общих (`/students/:id` до `/students`).
 *
 * Список обязан покрывать все живые маршруты из AppRoutes. Пропущенный
 * маршрут не ломается, но показывает в шапке «School OS» — так было
 * с «Программой курса», «Тестами» и всеми ученическими страницами.
 */
const PAGE_TITLES: Array<[RegExp, string]> = [
  [/^\/dashboard$/, 'Главная'],
  [/^\/student\/variants\/generate$/, 'Конструктор вариантов'],
  [/^\/student\/variants\/stats$/, 'Статистика по номерам'],
  [/^\/student\/variants\/build$/, 'PDF из корзины'],
  [/^\/student\/variants/, 'Тренировочные варианты'],
  [/^\/student$/, 'Мой кабинет'],
  [/^\/teacher$/, 'Кабинет учителя'],
  [/^\/admin\/telegram/, 'Журнал Telegram'],
  [/^\/admin$/, 'Панель админа'],
  [/^\/groups\/[^/]+$/, 'Панель группы'],
  [/^\/groups$/, 'Группы'],
  [/^\/students\/[^/]+\/journal/, 'Журнал ученика'],
  [/^\/students\/[^/]+/, 'Профиль ученика'],
  [/^\/students$/, 'Ученики'],
  [/^\/teachers\/[^/]+/, 'Преподаватель'],
  [/^\/lessons/, 'Занятия'],
  [/^\/lesson-library/, 'Библиотека уроков'],
  [/^\/course-program\/[^/]+\/topic-tests/, 'Тесты по темам курса'],
  [/^\/course-program/, 'Программа курса'],
  [/^\/homework-queue$/, 'Проверка ДЗ'],
  [/^\/live-work\//, 'Проверочная вживую'],
  [/^\/homework-review/, 'Проверка ДЗ'],
  [/^\/homework-templates/, 'Шаблоны ДЗ'],
  [/^\/homeworks/, 'Домашние задания'],
  [/^\/tests/, 'Банк тестов'],
  [/^\/catalog\/assets$/, 'Картинки каталога'],
  [/^\/catalog/, 'Каталог заданий'],
  [/^\/collections$/, 'Мои подборки'],
  [/^\/collections\//, 'Подборка'],
  [/^\/cart$/, 'Подборка'],
  [/^\/mock-exams$/, 'Пробники'],
  [/^\/mock-exams\/templates$/, 'Шаблоны пробников'],
  [/^\/mock-exams\/new$/, 'Новый пробник'],
  [/^\/mock-exams\/[^/]+\/review\//, 'Проверка пробника'],
  [/^\/mock-exams\/[^/]+$/, 'Пробник'],
  [/^\/variant-builder/, 'Конструктор вариантов'],
  [/^\/variants\/exam\/[^/]+\/[^/]+\/auto/, 'Автосборка теста'],
  [/^\/variants/, 'Тесты'],
  [/^\/my-course/, 'Мой курс'],
  [/^\/my-mock-exams$/, 'Пробники'],
  [/^\/my-homeworks$/, 'Домашние задания'],
  [/^\/my-homework/, 'Домашние задания'],
  [/^\/my-journal$/, 'Журнал занятий и заданий'],
  [/^\/notifications$/, 'Уведомления'],
  [/^\/settings$/, 'Настройки'],
  [/^\/subscription$/, 'Подписка и курсы'],
]

export function DashboardLayout() {
  const { profile, loading } = useAuthStore()
  const { effectiveRole, needsModeChoice, preview } = useStaffMode()
  const { enabled: mobilePreview } = useMobilePreview()
  const navigate = useNavigate()
  const location = useLocation()
  // §263. Режим работы ученика: пока идёт его проверочная/контрольная или
  // пробник, всё, кроме страницы работы, закрыто (замки держит и сервер).
  // Предпросмотр персонала «глазами ученика» режима не получает.
  const isStudent = profile?.role === 'student' && !preview
  useWorkModeSync(isStudent)
  const work = useWorkModeStore(s => s.work)
  const workOffsetMs = useWorkModeStore(s => s.offsetMs)
  const { theme, toggle: toggleTheme } = useStudentTheme()

  useEffect(() => {
    if (!loading && !profile) navigate('/login')
  }, [profile, loading, navigate])

  // If profile already loaded from cache — render immediately, don't block on loading.
  // Ждём с пределом по времени: профиль может не приехать вовсе, и тогда
  // кабинет обязан показать ошибку с кнопкой, а не вечный спиннер
  // (`LoadingGate`). Именно на этом шаге владелец поймал зависший вход.
  if (!profile && loading) {
    return <LoadingGate label="профиль пользователя" fullScreen />
  }

  if (!profile) return null

  // Экран выбора режима стоит ПЕРЕД кабинетом и покрывает все защищённые
  // маршруты сразу — он здесь, а не отдельным роутом, чтобы не заводить
  // редиректы туда-обратно и не гадать, куда возвращать после выбора.
  // Видят только admin/owner и только пока выбор в этом входе не сделан.
  if (needsModeChoice) return <StaffModeGate />

  // «Мобильный вид» (§181): ВМЕСТО дерева кабинета — рамка-«телефон» с тем же
  // приложением во вложенном окне. Внутри самого вложенного окна `enabled`
  // всегда false (`useMobilePreview`), и там рисуется обычное дерево.
  if (mobilePreview) return <MobilePreviewFrame />

  const initials = profile.full_name
    ? profile.full_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')
    : '?'
  const isFullscreenReviewRoute = /^\/homeworks\/[^/]+\/review(?:\/|$)/.test(location.pathname)
  const pageTitle = PAGE_TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1] || 'Школа Almiron'
  const activeWork = isStudent ? work : null
  const workClosed = !!activeWork && !workModeAllows(location.pathname, activeWork)
  // Стиль нового ЛК: ученик (письмо 14.10) и с 17.10 учитель и админ
  // (письмо ЛК_учитель_и_админ_редизайн.md) — один каркас, свои пункты меню.
  // Страницы персонала, ещё не переведённые в новый вид, в тёмной теме идут
  // светлым листом (как непереведённые экраны ученика).
  const viewRole = effectiveRole ?? profile.role
  const studentView = viewRole === 'student'

  return (
    <div className="stu flex min-h-screen" data-theme={theme}>
      {/* Меню: у ученика — вариант В (письмо ЛК_стиль_меню_ученика.md, 16.10):
          колонка 96px на компьютере, нижняя панель на телефоне. У персонала —
          прежнее боковое меню. */}
      {studentView ? <StudentNav /> : <StaffNav role={viewRole} />}

      {/* Main content: no left margin on mobile, 256px on md+ (у ученика — 96px) */}
      <div className="stu-main flex-1 min-w-0 md:ml-24 flex flex-col min-h-screen">
        <ImpersonationBanner />
        {/* Top bar */}
        <header className="stu-top h-[66px] flex items-center px-4 md:px-8 gap-3 shrink-0 sticky top-0 z-30">
          {/* Одна строка вместо двух. Подпись «Быстрый доступ через навигацию
              слева» ничего не сообщала, а иконка лупы рядом читалась как поиск,
              которого здесь нет. Освободившаяся высота отдана содержимому. */}
          <div className="min-w-0 flex-1">
            <div className="stu-title truncate leading-tight">
              <span className="stu-muted mr-2 hidden font-semibold lg:inline">Школа Almiron ·</span>
              {(studentView && studentPageTitle(location.pathname)) || pageTitle}
            </div>
          </div>

          {/* Скрыто на время MVP: уведомления не подключены к новому контуру
              (PROJECT_STATE §5.5). Вернуть — раскомментировать. */}
          {/* <NotificationBell /> */}

          {/* Режим представления — только у admin/owner, права не трогает */}
          <StaffModeSwitch />

          <button
            type="button"
            onClick={toggleTheme}
            className="stu-icon-btn"
            aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            data-testid="student-theme-toggle"
          >
            {theme === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
          </button>

          {/* Колокольчик и аватар с меню «Ещё» (ученик — письмо 16.10, персонал — 17.10).
              В предпросмотре «глазами ученика» колокольчика нет — это были бы
              собственные уведомления персонала. */}
          {!preview && <StudentBell />}
          {studentView ? (
            <StudentAvatarMenu avatar={
              <span className="stu-ava">
                {profile.avatar_url ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" /> : initials}
              </span>
            } />
          ) : (
            <StaffAvatarMenu role={viewRole} avatar={
              <span className="stu-ava" title={`${profile.full_name || 'Профиль'} · ${ROLE_LABELS[viewRole] || viewRole}`}>
                {profile.avatar_url ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" /> : initials}
              </span>
            } />
          )}

        </header>

        {/* Полоса предпросмотра «глазами ученика» (§178): под шапкой, на всю
            ширину содержимого, на любой странице, пока режим включён. */}
        <StudentPreviewBanner />

        {/* overflow-x-clip — защита от переполнения на телефоне (§158). Любой
            элемент шире экрана (строка без пробелов, длинный чип, ряд кнопок)
            заставлял мобильный Chrome ужать ВСЮ страницу до его ширины.
            Именно clip, а не hidden: hidden сделал бы main контейнером
            прокрутки, и position: sticky внутри (панели разбора, липкие
            колонки на xl) перестал бы липнуть. clip только режет выступающее.
            Таблицы с overflow-x-auto внутри страниц прокручиваются как прежде. */}
        <main className="flex-1 min-w-0 overflow-x-clip">
          {/* Adaptive padding: 16px mobile → 24px sm → 32px md+ */}
          <div className={isFullscreenReviewRoute
            ? 'min-w-0 h-[calc(100dvh-3.5rem)] px-0 py-0'
            : 'min-w-0 px-4 sm:px-6 md:px-8 py-3 sm:py-4 md:py-5 max-w-[1420px] mx-auto'}>
            {/* Приглашение привязать Telegram — над содержимым страницы, но не
                на полноэкранной проверке ДЗ: там рабочая область занимает весь
                экран, и полоска сверху ломала бы разметку холста. */}
            {activeWork && workClosed && <WorkModeStrip work={activeWork} offsetMs={workOffsetMs} showLink={false} />}
            {/* Главная ученика (письмо 16.10, «как в Notion») показывает приглашение
                сама — строкой под строкой свойств. */}
            {!isFullscreenReviewRoute && !workClosed && !(studentView && location.pathname === '/student') && <TelegramOnboarding skin />}
            {activeWork && workClosed
              ? <WorkModeClosed work={activeWork} section={PAGE_TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1] ?? null} />
              : !(studentView && studentSkinPage(location.pathname))
                // Страница ещё в прежнем виде: в тёмной теме — светлым листом.
                ? <div data-stu-scope="light"><Outlet /></div>
                : <Outlet />}
          </div>
        </main>
      </div>

      {/* Плавающая кнопка обращения — на всех страницах кабинета */}
      <SupportWidget />
    </div>
  )
}
