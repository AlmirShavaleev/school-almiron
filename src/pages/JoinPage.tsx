import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/authStore'
import { useAuth } from '@/hooks/useAuth'
import { clearPendingInvite, formatInviteCode, normalizeInviteCode, readPendingInvite, savePendingInvite } from '@/lib/studentInviteSession'
import { acceptStudentInvite, acceptStudentInviteByCode, acceptCourseJoin, ensureStudentProfile, InvitationAcceptanceError } from '@/lib/studentInvitationAcceptance'

type JoinMode = 'token' | 'code'
type AcceptState = 'idle' | 'success'

interface JoinResult {
  groupId: string | null
  courseTitle?: string
  joinedAs?: 'student' | 'curator'
}

function isStaffRole(role?: string | null): boolean {
  return ['teacher', 'admin', 'owner', 'curator', 'parent'].includes(role || '')
}

export function JoinPage() {
  const navigate = useNavigate()
  const { token } = useParams<{ token?: string }>()
  const profile = useAuthStore(state => state.profile)
  const user = useAuthStore(state => state.user)
  const { signOut } = useAuth()

  const mode: JoinMode = token ? 'token' : 'code'
  const [codeInput, setCodeInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<JoinResult | null>(null)

  useEffect(() => {
    if (token) {
      savePendingInvite({ type: 'token', value: token })
      return
    }
    const pending = readPendingInvite()
    if (pending?.type === 'code') {
      setCodeInput(formatInviteCode(pending.value))
    }
  }, [token])

  const normalizedCode = useMemo(() => normalizeInviteCode(codeInput), [codeInput])
  const pendingInvite = readPendingInvite()
  const wrongRole = isStaffRole(profile?.role)

  useEffect(() => {
    if (mode !== 'code') return
    if (normalizedCode) savePendingInvite({ type: 'code', value: normalizedCode })
  }, [mode, normalizedCode])

  async function acceptAny(tokenOrCode: string, isToken: boolean) {
    try {
      if (isToken) {
        return await acceptStudentInvite(tokenOrCode)
      } else {
        return await acceptStudentInviteByCode(tokenOrCode)
      }
    } catch (err) {
      const invError = err instanceof InvitationAcceptanceError ? err : null
      // Постоянная ссылка/код курса не лежат в enrollment_invites, поэтому
      // легаси-RPC на них отвечает INVITE_NOT_FOUND. Пробуем курсовую RPC не
      // только на kind='invalid', но и на 'unknown': mapError — строковая
      // эвристика по серверным сообщениям, и любое нераспознанное сообщение
      // (новый текст ошибки, иной SQLSTATE) не должно навсегда закрывать путь
      // курса — ровно на этом продовый сценарий и ломался.
      // Осмысленные отказы легаси (used / revoked / expired / wrong_role /
      // email_unconfirmed / group_full / group_unavailable / network) курсовым
      // fallback'ом НЕ подменяем — их показываем человеку как есть.
      if (invError && (invError.kind === 'invalid' || invError.kind === 'unknown')) {
        try {
          const courseAccepted = await acceptCourseJoin(tokenOrCode)
          return {
            groupId: courseAccepted.groupId,
            courseTitle: courseAccepted.courseTitle,
            joinedAs: courseAccepted.joinedAs,
          }
        } catch (courseErr) {
          // 'invalid': легаси прямо сказал «такого приглашения нет» — значит
          // пользователь почти наверняка шёл по курсовой ссылке, показываем
          // ошибку курса. 'unknown': легаси упал по своей (непонятой) причине,
          // курсовая попытка была спекулятивной — возвращаем исходную ошибку.
          throw invError.kind === 'invalid' ? courseErr : invError
        }
      }
      throw err
    }
  }

  async function handleAccept() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const accepted = await acceptAny(token || normalizedCode, !!token)
      clearPendingInvite()
      // Профиль мог появиться только что: курсовой путь создаёт его в
      // ensureStudentProfile, легаси — внутри _accept_invite_core. В сторе он
      // при этом всё ещё null (AppAuth грузил профиль до вступления), а
      // DashboardLayout при пустом профиле выкидывает на /login — то есть
      // кнопка «Открыть курс» вела бы на экран входа. Подтягиваем профиль.
      if (!useAuthStore.getState().profile) {
        try {
          const fresh = await ensureStudentProfile()
          if (fresh) useAuthStore.getState().setProfile(fresh)
        } catch {
          // не критично: профиль подтянется на следующем auth-событии
        }
      }
      setResult({
        groupId: accepted.groupId,
        courseTitle: (accepted as any).courseTitle,
        joinedAs: (accepted as any).joinedAs,
      })
    } catch (err) {
      const mapped = err instanceof InvitationAcceptanceError
        ? err
        : err instanceof Error
          ? new InvitationAcceptanceError('unknown', err.message)
          : new InvitationAcceptanceError('unknown', 'Не удалось обработать приглашение')
      if (['invalid', 'expired', 'revoked', 'used', 'group_unavailable', 'group_full'].includes(mapped.kind)) {
        clearPendingInvite()
      }
      setError(mapped.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSwitchAccount() {
    await signOut()
    navigate('/login')
  }

  function handleCodeContinue() {
    if (!normalizedCode) {
      setError('Введите код приглашения')
      return
    }
    savePendingInvite({ type: 'code', value: normalizedCode })
    setError(null)
  }

  const unauthenticated = !user

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white p-8 shadow-xl">
        {result ? (
          <div className="space-y-5 text-center" data-testid="join-success">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 size={28} />
            </div>
            <div>
              {result.joinedAs === 'curator' ? (
                <>
                  <h1 className="text-2xl font-bold text-gray-900">
                    Вы куратор курса «{result.courseTitle}»
                  </h1>
                  <p className="mt-2 text-gray-500">
                    Теперь вы можете проверять домашние задания и видеть результаты учеников этого курса.
                  </p>
                </>
              ) : (
                <>
                  <h1 className="text-2xl font-bold text-gray-900">Вы присоединились</h1>
                  <p className="mt-2 text-gray-500">
                    {result.courseTitle
                      ? `Вы зачислены на курс "${result.courseTitle}". Курс уже доступен в разделе "Мои курсы".`
                      : 'Вы добавлены в учебную группу. Курс уже доступен в разделе "Мои курсы".'}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              {result.joinedAs === 'curator' ? (
                <>
                  <Button onClick={() => navigate('/homework-queue')}>К проверке ДЗ</Button>
                  <Button variant="secondary" onClick={() => navigate('/course-program')}>Программа курса</Button>
                </>
              ) : (
                <>
                  <Button data-testid="join-open-course" onClick={() => navigate(`/my-course/${result.groupId}`)}>Открыть курс</Button>
                  <Button variant="secondary" onClick={() => navigate('/my-course')}>Перейти в мои курсы</Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-gray-900">Вас пригласили в School Almiron</h1>
              <p className="mt-2 text-gray-500">
                {mode === 'token'
                  ? 'Войдите в существующий аккаунт ученика или зарегистрируйтесь, чтобы присоединиться к группе.'
                  : 'Введите код курса или приглашения, затем войдите в существующий аккаунт ученика или зарегистрируйтесь.'}
              </p>
            </div>

            {mode === 'code' && (
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Код курса или приглашения</label>
                <input
                  data-testid="join-code-input"
                  aria-label="Код приглашения"
                  value={codeInput}
                  onChange={(event) => {
                    setCodeInput(formatInviteCode(event.target.value))
                    setError(null)
                  }}
                  onPaste={(event) => {
                    event.preventDefault()
                    const pasted = event.clipboardData.getData('text/plain')
                    setCodeInput(formatInviteCode(pasted))
                    setError(null)
                  }}
                  placeholder="ABCD-1234"
                  className="w-full rounded-xl border border-gray-200 px-4 py-3 text-lg tracking-[0.2em] focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <p className="text-xs text-gray-400">Код даёт преподаватель. Можно вводить с дефисами, пробелами и в любом регистре.</p>
              </div>
            )}

            {wrongRole ? (
              <div className="space-y-4 rounded-xl border border-amber-100 bg-amber-50 p-4">
                <p className="text-sm text-amber-800">Это приглашение предназначено для аккаунта ученика. Выйдите и войдите в ученический аккаунт.</p>
                <Button variant="secondary" onClick={handleSwitchAccount}>Войти в другой аккаунт</Button>
              </div>
            ) : unauthenticated ? (
              <div className="space-y-3">
                {mode === 'code' && (
                  <Button className="w-full" variant="secondary" onClick={handleCodeContinue}>
                    Сохранить код
                  </Button>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Link to="/login"><Button className="w-full" variant="secondary">Войти</Button></Link>
                  <Link to="/register"><Button className="w-full">Зарегистрироваться</Button></Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {mode === 'code' && !pendingInvite && (
                  <Button variant="secondary" onClick={handleCodeContinue}>Сохранить код</Button>
                )}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    data-testid="join-accept"
                    className="flex-1"
                    onClick={handleAccept}
                    loading={submitting}
                    disabled={mode === 'code' && !normalizedCode}
                  >
                    Присоединиться
                  </Button>
                  <Button className="flex-1" variant="secondary" onClick={handleSwitchAccount}>
                    Выйти и войти в другой аккаунт
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <div data-testid="join-error" className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {submitting && (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                Обрабатываем приглашение…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
