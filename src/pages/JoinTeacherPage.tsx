import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/authStore'
import { useAuth } from '@/hooks/useAuth'
import { savePendingTeacherJoinLink, clearPendingTeacherJoinLink } from '@/lib/teacherJoinLinkSession'
import { submitTeacherJoinRequest, TeacherJoinRequestError } from '@/lib/teacherJoinRequests'

function isStaffRole(role?: string | null): boolean {
  return ['teacher', 'admin', 'owner', 'curator', 'parent'].includes(role || '')
}

type SubmitState = 'idle' | 'submitting' | 'pending' | 'already_connected' | 'error'

export function JoinTeacherPage() {
  const navigate = useNavigate()
  const { token } = useParams<{ token: string }>()
  const profile = useAuthStore(state => state.profile)
  const user = useAuthStore(state => state.user)
  const { signOut } = useAuth()

  const [state, setState] = useState<SubmitState>('idle')
  const [error, setError] = useState<string | null>(null)
  const wrongRole = isStaffRole(profile?.role)
  const unauthenticated = !user
  // Tracks whether a submit is in flight/done for the current token, independent of
  // `state` -- if this guard lived in the effect's dependency array instead, the
  // setState('submitting') call below would re-trigger the effect.
  const submittedRef = useRef(false)
  // Identifies which token the in-flight request belongs to. Deliberately NOT a
  // per-effect-instance `cancelled` closure set by the cleanup function: React StrictMode
  // (dev only) synchronously mounts -> cleans up -> remounts on first render, so a
  // cleanup-driven `cancelled` flag goes true before the real network call resolves, and
  // the remount's own attempt is skipped by submittedRef -- net result: the RPC succeeds
  // server-side (row created) but no effect is ever allowed to apply its result, leaving
  // the UI stuck on "Отправляем заявку…" forever. Comparing against this token-identity
  // ref instead survives that double-invoke because refs aren't reset by cleanup.
  const activeTokenRef = useRef<string | null>(null)

  // Только тому, кому ссылка может пригодиться: она ведёт к «стать учеником
  // этого преподавателя». Сохранённая персоналу, она потом перехватывала бы
  // ему главную — та же ловушка, что и с ученическим приглашением.
  useEffect(() => {
    if (token && !wrongRole) savePendingTeacherJoinLink(token)
  }, [token, wrongRole])

  useEffect(() => {
    if (!token || unauthenticated || wrongRole || submittedRef.current) return
    submittedRef.current = true
    activeTokenRef.current = token
    setState('submitting')
    submitTeacherJoinRequest(token)
      .then(() => {
        if (activeTokenRef.current !== token) return
        clearPendingTeacherJoinLink()
        setState('pending')
      })
      .catch((err: unknown) => {
        if (activeTokenRef.current !== token) return
        const mapped = err instanceof TeacherJoinRequestError ? err : new TeacherJoinRequestError('unknown', 'Не удалось отправить заявку')
        if (mapped.kind === 'already_connected') {
          clearPendingTeacherJoinLink()
          setState('already_connected')
        } else {
          submittedRef.current = false
          setError(mapped.message)
          setState('error')
        }
      })
  }, [token, unauthenticated, wrongRole])

  async function handleSwitchAccount() {
    await signOut()
    navigate('/login')
  }

  /** Выход из тупика — см. тот же приём в JoinPage. */
  function handleNotMine() {
    clearPendingTeacherJoinLink()
    navigate('/dashboard', { replace: true })
  }

  function handleRetry() {
    setError(null)
    submittedRef.current = false
    setState('idle')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-xl">
        {state === 'pending' || state === 'already_connected' ? (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {state === 'already_connected' ? 'Вы уже связаны с этим преподавателем' : 'Заявка отправлена'}
              </h1>
              <p className="mt-2 text-gray-500">
                {state === 'already_connected'
                  ? 'Дополнительных действий не требуется.'
                  : 'Преподаватель рассмотрит вашу заявку и распределит вас на курс. Доступ к курсам появится после подтверждения.'}
              </p>
            </div>
            <Button onClick={() => navigate('/student')}>Перейти в кабинет</Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-900">Регистрация у преподавателя</h1>
              <p className="mt-2 text-gray-500">
                Войдите в существующий аккаунт ученика или зарегистрируйтесь, чтобы отправить заявку преподавателю.
              </p>
            </div>

            {wrongRole ? (
              <div className="space-y-4 rounded-xl border border-amber-100 bg-amber-50 p-4">
                <p className="text-sm text-amber-800">
                  Эта ссылка предназначена для аккаунта ученика. Войдите в ученический аккаунт —
                  или уберите ссылку, если она попала к вам случайно.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button variant="secondary" onClick={handleSwitchAccount}>Войти в другой аккаунт</Button>
                  <Button data-testid="join-teacher-not-mine" variant="ghost" onClick={handleNotMine}>
                    Это не моя ссылка
                  </Button>
                </div>
              </div>
            ) : unauthenticated ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Link to="/login"><Button className="w-full" variant="secondary">Войти</Button></Link>
                <Link to="/register"><Button className="w-full">Зарегистрироваться</Button></Link>
              </div>
            ) : state === 'submitting' ? (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                Отправляем заявку…
              </div>
            ) : state === 'error' ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
                <Button variant="secondary" onClick={handleRetry}>Попробовать снова</Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
