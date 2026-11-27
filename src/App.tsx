import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { RumTracker } from '@/components/perf/RumTracker'
import { useEffect, Suspense } from 'react'
import { lazyPage } from '@/lib/lazyPage'
import { claimDailyVisit, shouldReloadProfile, type LoadedProfileMark } from '@/lib/authRefreshPolicy'
import { clearReadCache } from '@/lib/perf/readCoalesce'
import { LoadingGate } from '@/components/shared/LoadingGate'
import { LoadErrorBoundary } from '@/components/shared/LoadErrorBoundary'
import { useSessionExpiry } from '@/lib/draftIdentity'

import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { Toaster } from '@/components/ui/Toaster'
import { CatalogImageLightbox } from '@/components/catalog/CatalogImageLightbox'
import { getPendingInvitePath } from '@/lib/studentInviteSession'
import { getPendingTeacherJoinLinkPath } from '@/lib/teacherJoinLinkSession'
import { getPendingSubscribePath } from '@/lib/subscription/pendingSubscribe'
import { LANDING_PREVIEW_PATH, landingV3Enabled } from '@/lib/landingFlag'
import { SubscriptionsOnly } from '@/components/subscription/SubscriptionsOnly'

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
// lazyPage добавляет контекст для восстановления при ошибке загрузки ресурса.
//
// Лендинга для гостя сейчас нет (письмо ЛК_убрать_старый_лендинг.md, 17.10:
// «пусть видят сразу вход в ЛК»): `/` и `/about` — на вход. Прежний лендинг
// (src/pages/LandingPage.tsx, components/landing) не удалён, просто не
// подключён — его чанка в сборке нет. Лендинг v3 (ЛЕНДИНГ_ТЗ.md, 11.10) — за
// флагом сборки VITE_LANDING_V3 и на скрытом `/preview/landing` (src/lib/landingFlag.ts).
const LandingV3Page     = lazyPage('LandingV3Page', () => import('@/pages/LandingV3Page').then(m => ({ default: m.LandingV3Page })))
const PaymentResultPage = lazyPage('PaymentResultPage', () => import('@/pages/PaymentResultPage').then(m => ({ default: m.PaymentResultPage })))
const SubscribePage     = lazyPage('SubscribePage', () => import('@/pages/subscription/SubscribePage').then(m => ({ default: m.SubscribePage })))

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
 * `/` → рабочий экран вошедшего, лендинг для гостя (с 11.10.2026, ЛЕНДИНГ_ТЗ.md;
 * с 12.08 по 11.10 гость уходил на `/login`). Гость с отложенным намерением
 * (приглашение, ссылка преподавателя, возврат из письма) по-прежнему уходит на вход.
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
    // Роль передаётся ОБЯЗАТЕЛЬНО. Без неё корень уводил на приглашение
    // кого угодно, включая владельца: он открывал главную, попадал на
    // `/join/<token>`, читал «приглашение предназначено для аккаунта ученика»
    // и возвращался на главную — в свой кабинет было не войти вовсе. Теперь
    // неподходящая роль означает, что приглашение здесь же вычищается.
    // `profile?.role ?? null` — именно null, а не пропуск аргумента: пустая
    // роль читается как «ещё не знаем» и приглашение не трогает (у только что
    // зарегистрировавшегося профиль едет позже, а вести его надо как раз туда).
    const role = profile?.role ?? null
    const pendingPath = getPendingInvitePath(role) || getPendingTeacherJoinLinkPath(role) || getPendingSubscribePath(role)
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

  // Гость с отложенным намерением — висящее приглашение ученика или ссылка
  // преподавателя — или пришедший по ссылке из письма Supabase: ведём на вход,
  // как и раньше, там намерение подхватится после входа. Именно `replace`:
  // иначе «назад» из формы входа возвращало бы на `/`, а тот снова редиректил
  // бы на вход — кнопка «назад» переставала бы работать.
  // Лендинг v3 выключен (по умолчанию, как в main) — любой гость на вход.
  if (!landingV3Enabled() || guestHasPendingIntent()) return <Navigate to="/login" replace />

  // v3 включён: просто гость видит лендинг прямо на главной (ЛЕНДИНГ_ТЗ.md, 11.10.2026).
  return <LandingV3Page />
}

/** `/about` без лендинга — на вход с теми же параметрами и якорем (письмо 17.10). */
function KeepQueryToLogin() {
  const { search, hash } = useLocation()
  return <Navigate to={{ pathname: '/login', search, hash }} replace />
}

/** Скрытый просмотр лендинга v3 для владельца: не в меню, поисковикам — noindex. */
function LandingV3Preview() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [])
  return <LandingV3Page />
}

/**
 * Есть ли у гостя дело, ради которого он должен попасть на вход, а не на
 * витрину. Роль `null` — «ещё не знаем»: проверка приглашение не вычищает.
 * Параметры `access_token` / `error` / `code` в адресе — это возврат из письма
 * подтверждения или сброса, его разбирает вход, а не лендинг.
 */
function guestHasPendingIntent(): boolean {
  if (getPendingInvitePath(null) || getPendingTeacherJoinLinkPath(null)) return true
  const { hash, search } = window.location
  return /(^|[#&])(access_token|error|error_code)=/.test(hash) || /[?&](code|error)=/.test(search)
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
  useSessionExpiry(clearReadCache)

  useEffect(() => {
    let cancelled = false
    let receivedAuthEvent = false
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
    // 15.11: чей профиль и когда загружен — чтобы возврат на вкладку не перечитывал его каждый раз.
    const loaded: LoadedProfileMark = { profileId: null, loadedAt: 0 }

    type ProfileUser = { id: string; email?: string; user_metadata?: any }
    function loadProfileOnce(user: ProfileUser, epoch: number) {
      const isCurrent = () => {
        const current = useAuthStore.getState()
        return !cancelled && current.identityEpoch === epoch && current.user?.id === user.id
      }
      if (!isCurrent()) return
      const key = `${epoch}:${user.id}`
      const running = inflight.get(key)
      if (running) return running
      const promise = loadProfile(user, isCurrent).finally(() => { inflight.delete(key) })
      inflight.set(key, promise)
      return promise
    }

    // §272. Сбой сети при чтении профиля не должен оставлять вечный спиннер: ошибка — в консоль,
    // `loading` снимается всё равно (дальше RoleGuard/DashboardLayout покажут вход или ошибку).
    async function loadProfile(user: ProfileUser, isCurrent: () => boolean) {
      try {
        await loadProfileInner(user, isCurrent)
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[вход] профиль не загрузился', e)
        if (isCurrent()) setLoading(false)
      }
    }

    async function loadProfileInner(user: ProfileUser, isCurrent: () => boolean) {
      let { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      if (!isCurrent()) return
      if (error) throw error
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
        if (!isCurrent()) return
        const res = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
        if (!isCurrent()) return
        if (res.error) throw res.error
        data = res.data
      }
      // Same auth event fires on every token refresh (periodic, unrelated to
      // profile content). Skip setProfile when the row is byte-for-byte the
      // same as what's already in the store — a fresh object reference here
      // ripples into every `useEffect`/`useMemo` that has `profile` (not
      // `profile?.id`) in its deps array and re-triggers it for nothing.
      if (!data || data.id !== user.id) { setProfile(null); setLoading(false); return }
      if (!profilesEqual(useAuthStore.getState().profile as any, data as any)) {
        setProfile(data as any)
      }
      setLoading(false)
      loaded.profileId = user.id
      loaded.loadedAt = Date.now()

      // Отметка «человек заходил сегодня» для дашборда школы. Одна строка на
      // человека в сутки, повтор гасит первичный ключ на стороне базы. 15.11:
      // раньше уходила на каждое событие авторизации (у телефона — на каждое
      // возвращение во вкладку); теперь раз в сутки по Москве на устройство.
      // Ошибку намеренно проглатываем: счётчик не должен ломать вход.
      if (isCurrent() && claimDailyVisit(user.id)) {
        void (supabase as any).rpc('record_app_visit').then(() => {}, () => {})
      }
    }

    // Initialise from persisted session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || receivedAuthEvent) return
      setUser(session?.user ?? null)
      setSession(session)
      if (session?.user) void loadProfileOnce(session.user, useAuthStore.getState().identityEpoch)
      else setLoading(false)
    }).catch(() => { if (!cancelled && !receivedAuthEvent) setLoading(false) })

    // Listen for subsequent auth events
    // §272. Колбэк НЕ async и профиль грузится через setTimeout(0), а не `await` прямо здесь.
    // supabase-js зовёт подписчиков, держа свой замок авторизации (обновление токена при первом
    // входе после перерыва, SIGNED_IN, INITIAL_SESSION). Запрос к `profiles` внутри колбэка
    // просит тот же замок для токена — и ждёт сам себя: профиль не приходит никогда, экран
    // висит на «Загрузка идёт дольше обычного…», пока не нажать F5 (токен уже свежий — замок
    // не нужен). Так документация supabase-js и велит: другие вызовы Supabase — после колбэка.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      receivedAuthEvent = true
      if (useAuthStore.getState().user?.id !== session?.user?.id) {
        loaded.profileId = null
        clearReadCache()
      }
      setUser(session?.user ?? null)
      setSession(session)
      if (session?.user) {
        const user = session.user
        // 15.11: тот же человек, профиль свежий — не перечитываем (возврат на вкладку, обновление токена).
        if (!shouldReloadProfile(event, user.id, loaded)) return
        const epoch = useAuthStore.getState().identityEpoch
        setTimeout(() => { if (!cancelled) void loadProfileOnce(user, epoch) }, 0)
      } else if (event === 'SIGNED_OUT') {
        loaded.profileId = null
        clearReadCache()
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

function AccountRoutes() {
  const epoch = useAuthStore(state => state.identityEpoch)
  return <AppRoutes key={epoch} />
}

export default function App() {
  return (
    <LoadErrorBoundary>
    <BrowserRouter>
      <AppAuth />
      {/* §291: свой RUM — сколько ученик ждёт вкладки и запросы к базе */}
      <RumTracker />
      {/* Vercel Web Analytics — счётчик просмотров страниц на всё приложение
          (решение владельца 14.08, оно же меняет §107 в части «внешние
          счётчики»: здесь нет кук и межсайтовой слежки).

          Стоит ЗДЕСЬ по трём причинам:
          • один экземпляр на приложение — два дали бы двойной счёт;
          • ВЫШЕ <Suspense>, а не внутри: показ страницы от него не зависит
            вовсе, и не загрузившийся скрипт (блокировщик, нет сети) не может
            задержать первый экран — компонент рисует null, а сам скрипт грузится
            с `defer` и своим `onerror`;
          • внутри роутера: переходы SPA считает сам скрипт, подменяя
            history.pushState, — своего кода отслеживания мы не пишем.

          `mode` задан явно, а не оставлен на «auto». Авто-определение читает
          `process.env.NODE_ENV`, которого в браузерном коде Vite может не
          оказаться вовсе, а в этом случае пакет молча считает режим боевым и
          шлёт данные с localhost. `import.meta.env.DEV` Vite гарантирует.
          В режиме development пакет грузит script.debug.js: тот пишет события
          в консоль и НЕ отправляет их.

          Пользовательских событий нет: `track()` не вызывается нигде. */}
      <Analytics mode={import.meta.env.DEV ? 'development' : 'production'} />
      {/* Vercel Speed Insights — замер скорости загрузки страниц у настоящих
          посетителей (Core Web Vitals). Это ДОПОЛНЕНИЕ к <Analytics/>, а не
          замена: тот считает просмотры, этот — время. Отдельный пакет и
          отдельный скрипт, поэтому и компонент отдельный.

          Стоит здесь по тем же трём причинам, что и счётчик просмотров выше:
          один экземпляр на приложение (два дали бы двойной замер), ВЫШЕ
          <Suspense> — показ страницы от него не зависит, и не загрузившийся
          скрипт (блокировщик, слабая сеть) не может задержать первый экран;
          внутри роутера — переходы SPA скрипт отслеживает сам.

          `scriptSrc` задан явно, и это здесь ЕДИНСТВЕННЫЙ способ. У пакета
          speed-insights нет свойства `mode` (в отличие от analytics): режим он
          определяет сам, читая `process.env.NODE_ENV` внутри try/catch. В
          браузерном коде Vite `process` может не существовать вовсе — тогда
          catch проглатывает ошибку и пакет считает режим боевым, то есть шлёт
          замеры с машины разработчика. Поэтому адрес скрипта выбираем сами по
          `import.meta.env.DEV`, который Vite гарантирует и подставляет
          константой. Отладочный скрипт печатает замеры в консоль и НЕ
          отправляет их; боевой `/_vercel/speed-insights/script.js` отдаёт сам
          Vercel — и только при включённом в настройках проекта Speed Insights.

          Своих событий нет: `beforeSend`, `route` и `dsn` не передаются, в
          адреса ничего не добавляется — как и договорились в §131. */}
      <SpeedInsights
        scriptSrc={import.meta.env.DEV
          ? 'https://va.vercel-scripts.com/v1/speed-insights/script.debug.js'
          : '/_vercel/speed-insights/script.js'}
      />
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
        <Route path="/about"          element={landingV3Enabled() ? <LandingV3Page /> : <KeepQueryToLogin />} />
        <Route path={LANDING_PREVIEW_PATH} element={<LandingV3Preview />} />
        <Route path="/payment-result" element={<PaymentResultPage />} />
        {/* §282. Витрина подписки: гость выбирает тариф до регистрации. */}
        {/* Без флага подписки (гость — всегда) — на главную: витрины тарифов не видно (выкатка в main, 16.10). */}
        <Route path="/subscribe"      element={<SubscriptionsOnly><SubscribePage /></SubscriptionsOnly>} />
        <Route path="/login"          element={<LoginPage />} />
        <Route path="/register"       element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password"  element={<ResetPasswordPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:token" element={<JoinPage />} />
        <Route path="/jt/:token" element={<JoinTeacherPage />} />

        {/* Protected app subtree — lazy chunk, own nested <Routes> (see AppRoutes.tsx) */}
        <Route path="/*" element={<AccountRoutes />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </LoadErrorBoundary>
  )
}
