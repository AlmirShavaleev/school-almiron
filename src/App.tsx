import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useEffect, Component, Suspense, type ReactNode } from 'react'
import { isChunkLoadError, lazyPage } from '@/lib/lazyPage'
import { LoadingGate } from '@/components/shared/LoadingGate'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      const error = this.state.error as Error
      // Не доехал файл страницы (обычно — вкладка была открыта до деплоя).
      // lazyPage такое чинит сам, сюда попадёт лишь то, что он не осилил:
      // повторный сбой или обрыв не на границе lazy. Показывать пользователю
      // «Failed to fetch dynamically imported module» и стек в таком случае
      // бессмысленно — он ничего с этим не сделает, кроме перезагрузки.
      if (isChunkLoadError(error)) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
            <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
              <h1 className="text-lg font-bold text-gray-900 mb-2">Вышло обновление</h1>
              <p className="text-sm text-gray-500">
                Страница не догрузилась, потому что приложение обновилось. Обновите вкладку —
                всё встанет на место.
              </p>
              <button
                className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm"
                onClick={() => window.location.reload()}
              >
                Обновить страницу
              </button>
            </div>
          </div>
        )
      }
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-8">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full">
            <h1 className="text-xl font-bold text-red-600 mb-3">Ошибка приложения</h1>
            <pre className="text-sm text-gray-700 bg-gray-50 p-4 rounded-lg overflow-auto whitespace-pre-wrap">
              {error.message}
              {'\n\n'}
              {error.stack}
            </pre>
            <button
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm"
              onClick={() => window.location.reload()}
            >
              Перезагрузить
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Toaster } from '@/components/ui/Toaster'
import { CatalogImageLightbox } from '@/components/catalog/CatalogImageLightbox'
import { getPendingInvitePath } from '@/lib/studentInviteSession'
import { getPendingTeacherJoinLinkPath } from '@/lib/teacherJoinLinkSession'

// Auth pages — тоже ленивые. Они тянут react-hook-form + zod + resolvers, а
// вошедший пользователь не видит ни одной из них: держать их во входном чанке
// значит заставлять КАЖДУЮ загрузку ждать код формы логина. Suspense-граница
// для них уже есть — та же, что у публичных страниц.
const LoginPage          = lazyPage('LoginPage', () => import('@/pages/auth/LoginPage').then(m => ({ default: m.LoginPage })))
const RegisterPage       = lazyPage('RegisterPage', () => import('@/pages/auth/RegisterPage').then(m => ({ default: m.RegisterPage })))
const ForgotPasswordPage = lazyPage('ForgotPasswordPage', () => import('@/pages/auth/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage  = lazyPage('ResetPasswordPage', () => import('@/pages/auth/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })))
const JoinPage           = lazyPage('JoinPage', () => import('@/pages/JoinPage').then(m => ({ default: m.JoinPage })))
const JoinTeacherPage    = lazyPage('JoinTeacherPage', () => import('@/pages/JoinTeacherPage').then(m => ({ default: m.JoinTeacherPage })))

// Public — lazy-loaded so framer-motion + landing components stay out of the main chunk.
// lazyPage вместо голого lazy: он сам перезагружает страницу, если файл чанка
// не доехал после свежего деплоя (см. комментарий в @/lib/lazyPage).
//
// Лендинг живёт на `/about`, а не на `/` (решение владельца 12.08): главная —
// это вход в платформу, а витрина откладывается, но не удаляется. Страница,
// стили и секции не тронуты, поменялся только адрес.
const LandingPage       = lazyPage('LandingPage', () => import('@/pages/LandingPage').then(m => ({ default: m.LandingPage })))
const PaymentResultPage = lazyPage('PaymentResultPage', () => import('@/pages/PaymentResultPage').then(m => ({ default: m.PaymentResultPage })))

// Protected app subtree (DashboardLayout + all its child routes) — lazy so its page code stays out of the entry chunk
const AppRoutes = lazyPage('AppRoutes', () => import('@/AppRoutes'))

/** Полноэкранный спиннер — общий для loading-состояния и Suspense-фолбэка. */
/**
 * Ожидание загрузки приложения. Через `LoadingGate` — с пределом по времени:
 * бесконечный спиннер не должен быть достижимым состоянием (см. компонент).
 */
function FullScreenSpinner({ label = 'вход в приложение' }: { label?: string }) {
  return <LoadingGate label={label} fullScreen />
}

/**
 * `/` → рабочий экран вошедшего, форма входа для гостя.
 *
 * Лендинга здесь больше нет — он переехал на `/about`. Главная стала входом в
 * платформу: по адресу приходят те, кто уже учится, а не те, кого надо
 * уговаривать.
 *
 * Уйти на `/login` можно только УБЕДИВШИСЬ, что сессии нет. Пока `loading` или
 * пока есть `user` без загруженного профиля — держим спиннер: `/login` назад не
 * отправляет, и человек с живой сессией застрял бы на «войдите» из-за того, что
 * профиль приезжает не мгновенно.
 */
function RootRedirect() {
  const { profile, user, loading } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    // This is where Supabase's email-confirmation link lands (emailRedirectTo = origin + "/").
    // A pending teacher-join-link intent must be checked here too, not just on /login --
    // otherwise the confirmation redirect drops the user straight onto /dashboard and the
    // join request never gets submitted until they manually reopen the /jt/:token link.
    const pendingPath = getPendingInvitePath() || getPendingTeacherJoinLinkPath()
    if (pendingPath && (profile || user)) {
      navigate(pendingPath, { replace: true })
      return
    }
    if (profile) navigate('/dashboard', { replace: true })
  }, [profile, user, loading, navigate])

  // `user` без `profile` — тоже ожидание, а не «гость»: сессия уже есть, просто
  // строка профиля ещё едет. Отправить такого на вход значит выкинуть человека
  // с живой сессией. Ждём через LoadingGate, у него есть предел по времени
  // (§108: бесконечный спиннер не должен быть достижимым состоянием).
  if (loading || profile || user) return <FullScreenSpinner />

  // Гость. Именно `replace`: иначе «назад» из формы входа возвращало бы на `/`,
  // а тот снова редиректил бы на вход — кнопка «назад» переставала бы работать.
  return <Navigate to="/login" replace />
}

/**
 * Field-by-field diff of two profile rows (Object.keys of both sides, not a
 * hardcoded field list — a new `profiles` column must show up in the diff
 * automatically, not silently compare as "unchanged").
 */
function profilesEqual(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

/**
 * Single source of truth for auth state.
 * Runs once at app level — no duplicate listeners.
 */
export function AppAuth() {
  const { setUser, setSession, setProfile, setLoading, reset } = useAuthStore()

  useEffect(() => {
    let cancelled = false
    /**
     * На старте профиль грузился ДВАЖДЫ: `getSession()` вызывает loadProfile
     * сам, и почти одновременно приходит событие INITIAL_SESSION — с тем же
     * пользователем. Два одинаковых запроса к `profiles` в самом начале
     * загрузки, а следом и две попытки вставить строку профиля новичку.
     * Схлопываем совпадающие вызовы: второй ждёт результат первого. Запись
     * убирается по завершении, поэтому обновление токена позже так же
     * перечитает профиль, как и раньше.
     */
    const inflight = new Map<string, Promise<void>>()

    function loadProfileOnce(user: { id: string; email?: string; user_metadata?: any }) {
      const running = inflight.get(user.id)
      if (running) return running
      const promise = loadProfile(user).finally(() => { inflight.delete(user.id) })
      inflight.set(user.id, promise)
      return promise
    }

    async function loadProfile(user: { id: string; email?: string; user_metadata?: any }) {
      let { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      // Самозарегистрированный пользователь без профиля (email-подтверждение) →
      // создаём профиль роли student. RLS разрешает само-вставку ТОЛЬКО своей
      // строки (id = auth.uid()), поэтому вставлять можно исключительно там, где
      // сессия уже есть, — то есть здесь, а не в signUp: при включённом
      // подтверждении почты сразу после signUp сессии нет вообще.
      //
      // Раньше здесь стояло дополнительное условие `&& !hasPendingInvite()`:
      // пока в sessionStorage висит приглашение, профиль не создавался — расчёт
      // был на то, что легаси-RPC `_accept_invite_core` создаст его сама и
      // подставит ФИО из приглашения преподавателя. Для курсовых ссылок
      // (course_join_accept) это оказалось смертельным: RPC читает
      // `select p.role from profiles` , получает NULL и падает на
      // `v_role is distinct from 'student'` сообщением «По этой ссылке
      // присоединяются только ученики» — ни один ученик так и не вступил.
      // Профиль нужен ОБОИМ курсовым веткам: ученической (проверка роли) и
      // кураторской (`update profiles set role='curator'` по существующей
      // строке), поэтому создаём его сразу, как только появилась сессия.
      //
      // Плата за это: легаси-приглашение теперь застаёт профиль уже созданным и
      // не перезаписывает full_name именем из списка преподавателя. Чтобы в
      // журнале не появлялись пустые строки, берём лучшее из доступного:
      // ФИО из метаданных регистрации → локальная часть email. Ученик и
      // преподаватель могут поправить ФИО в профиле; курсовое вступление,
      // которое не работало вовсе, важнее точности автозаполнения имени.
      if (!data) {
        const metaName = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : ''
        const email = user.email || ''
        await supabase.from('profiles').insert({
          id:        user.id,
          email,
          full_name: metaName || email.split('@')[0] || 'Ученик',
          role:      'student',
        } as any)
        const res = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
        data = res.data
      }
      // Same auth event fires on every token refresh (periodic, unrelated to
      // profile content). Skip setProfile when the row is byte-for-byte the
      // same as what's already in the store — a fresh object reference here
      // ripples into every `useEffect`/`useMemo` that has `profile` (not
      // `profile?.id`) in its deps array and re-triggers it for nothing.
      if (!cancelled && data && !profilesEqual(useAuthStore.getState().profile as any, data as any)) {
        setProfile(data as any)
      }
      if (!cancelled && !data) setProfile(null)
      if (!cancelled) setLoading(false)

      // Отметка «человек заходил сегодня» для дашборда школы. Одна строка на
      // человека в сутки, повтор гасит первичный ключ на стороне базы, поэтому
      // звать можно сколько угодно раз. Ошибку намеренно проглатываем: счётчик
      // активности не должен ломать вход, если запрос не прошёл.
      if (!cancelled && data) {
        void (supabase as any).rpc('record_app_visit').then(() => {}, () => {})
      }
    }

    // Initialise from persisted session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) void loadProfileOnce(session.user)
      else setLoading(false)
    })

    // Listen for subsequent auth events
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (cancelled) return
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        await loadProfileOnce(session.user)
      } else if (event === 'SIGNED_OUT') {
        reset()
        setLoading(false)
      } else {
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  // Store setters are stable references from zustand — safe to omit
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <AppAuth />
      <Toaster />
      {/* Клик по картинке задачи каталога — полноэкранный просмотр (см. компонент) */}
      <CatalogImageLightbox />
      <Suspense fallback={<FullScreenSpinner label="страница" />}>
      <Routes>
        {/* Public.
            ВНИМАНИЕ: этот список — граница «пускаем без входа». Всё, чего в нём
            нет, уходит в `/*` под DashboardLayout и отправляется на `/login`.
            По `/join`, `/join/:token` и `/jt/:token` приходят приглашённые
            ученики и преподаватели — они гости по определению, редирект на вход
            сломал бы вступление в курс. Трогать список только осознанно. */}
        <Route path="/"               element={<RootRedirect />} />
        <Route path="/about"          element={<LandingPage />} />
        <Route path="/payment-result" element={<PaymentResultPage />} />
        <Route path="/login"          element={<LoginPage />} />
        <Route path="/register"       element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:token" element={<JoinPage />} />
        <Route path="/jt/:token" element={<JoinTeacherPage />} />

        {/* Protected app subtree — lazy chunk, own nested <Routes> (see AppRoutes.tsx) */}
        <Route path="/*" element={<AppRoutes />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
