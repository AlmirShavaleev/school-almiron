import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
// import { NotificationBell } from './NotificationBell' // скрыто на время MVP
import { ImpersonationBanner } from '@/components/demo/ImpersonationBanner'
import { useAuthStore } from '@/store/authStore'
import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Menu } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  student:  'Ученик',
  teacher:  'Учитель',
  curator:  'Куратор',
  admin:    'Администратор',
  owner:    'Владелец',
}

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
  [/^\/student\/variants/, 'Тренировочные варианты'],
  [/^\/student$/, 'Мой кабинет'],
  [/^\/teacher$/, 'Кабинет учителя'],
  [/^\/curator$/, 'Кабинет куратора'],
  [/^\/admin$/, 'Панель админа'],
  [/^\/owner$/, 'Школа'],
  [/^\/groups\/[^/]+$/, 'Панель группы'],
  [/^\/groups$/, 'Группы'],
  [/^\/students\/[^/]+\/journal/, 'Журнал ученика'],
  [/^\/students\/[^/]+/, 'Профиль ученика'],
  [/^\/students$/, 'Ученики'],
  [/^\/teachers\/[^/]+/, 'Преподаватель'],
  [/^\/inbox$/, 'Очередь задач'],
  [/^\/schedule$/, 'Расписание'],
  [/^\/attendance$/, 'Посещаемость'],
  [/^\/lessons/, 'Занятия'],
  [/^\/lesson-library/, 'Библиотека уроков'],
  [/^\/course-program/, 'Программа курса'],
  [/^\/homework-queue$/, 'Проверка ДЗ'],
  [/^\/homework-review/, 'Проверка ДЗ'],
  [/^\/homework-templates/, 'Шаблоны ДЗ'],
  [/^\/assign-homework/, 'Назначение работ'],
  [/^\/homeworks/, 'Домашние задания'],
  [/^\/review-submissions/, 'Проверка работ'],
  [/^\/tests/, 'Тесты'],
  [/^\/catalog/, 'Каталог заданий'],
  [/^\/collections\//, 'Подборка'],
  [/^\/cart$/, 'Подборка'],
  [/^\/mock-exams$/, 'Пробники'],
  [/^\/variant-builder/, 'Конструктор вариантов'],
  [/^\/variants/, 'Варианты'],
  [/^\/my-course/, 'Мой курс'],
  [/^\/my-homeworks$/, 'Домашние задания'],
  [/^\/my-homework/, 'Домашние задания'],
  [/^\/my-assignments/, 'Мои задания'],
  [/^\/my-progress$/, 'Прогресс'],
  [/^\/payments$/, 'Платежи'],
  [/^\/notifications$/, 'Уведомления'],
  [/^\/settings$/, 'Настройки'],
]

export function DashboardLayout() {
  const { profile, loading } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Close sidebar on ESC
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!loading && !profile) navigate('/login')
  }, [profile, loading, navigate])

  // If profile already loaded from cache — render immediately, don't block on loading
  if (!profile && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-50 to-primary-50/30">
        <div className="platform-surface rounded-lg flex flex-col items-center gap-4 px-8 py-7">
          <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-800 rounded-full animate-spin" />
          <span className="text-slate-500 text-sm font-medium">Загрузка платформы...</span>
        </div>
      </div>
    )
  }

  if (!profile) return null

  const initials = profile.full_name
    ? profile.full_name.split(' ').map((w: string) => w[0]).slice(0, 2).join('')
    : '?'
  const isFullscreenReviewRoute = /^\/homeworks\/[^/]+\/review(?:\/|$)/.test(location.pathname)
  const pageTitle = PAGE_TITLES.find(([pattern]) => pattern.test(location.pathname))?.[1] || 'Школа Almiron'

  return (
    <div className="flex min-h-screen bg-transparent text-graphite-900">
      {/* Sidebar — receives open/onClose for mobile drawer behaviour */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content: no left margin on mobile, 256px on md+ */}
      <div className="flex-1 min-w-0 md:ml-64 flex flex-col min-h-screen">
        <ImpersonationBanner />
        {/* Top bar */}
        <header className="h-16 bg-white/82 backdrop-blur-xl border-b border-slate-200/70 flex items-center px-4 md:px-8 gap-3 shrink-0 sticky top-0 z-30">
          {/* Hamburger — visible only on mobile */}
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden w-11 h-11 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-graphite-900 transition-colors shrink-0"
            aria-label="Открыть меню"
          >
            <Menu size={20} />
          </button>

          {/* Одна строка вместо двух. Подпись «Быстрый доступ через навигацию
              слева» ничего не сообщала, а иконка лупы рядом читалась как поиск,
              которого здесь нет. Освободившаяся высота отдана содержимому. */}
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-graphite-950 truncate leading-tight">
              {pageTitle}
            </div>
          </div>

          {/* Скрыто на время MVP: уведомления не подключены к новому контуру
              (PROJECT_STATE §5.5). Вернуть — раскомментировать. */}
          {/* <NotificationBell /> */}

          {/* Avatar + name */}
          <div className="flex items-center gap-2.5 pl-3 border-l border-slate-200">
            <div className="w-9 h-9 rounded-lg bg-primary-950 flex items-center justify-center text-white font-bold text-xs overflow-hidden shrink-0 shadow-sm shadow-primary-950/15">
              {profile.avatar_url
                ? <img src={profile.avatar_url} className="w-full h-full object-cover" alt="" />
                : initials
              }
            </div>
            <div className="hidden sm:block">
              <div className="text-sm font-semibold text-graphite-950 leading-tight">{profile.full_name || 'Профиль'}</div>
              <div className="text-xs text-slate-500 leading-tight">{ROLE_LABELS[profile.role] || profile.role}</div>
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0">
          {/* Adaptive padding: 16px mobile → 24px sm → 32px md+ */}
          <div className={isFullscreenReviewRoute
            ? 'min-w-0 h-[calc(100dvh-3.5rem)] px-0 py-0'
            : 'min-w-0 px-4 sm:px-6 md:px-8 py-3 sm:py-4 md:py-5 max-w-[1420px] mx-auto'}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
