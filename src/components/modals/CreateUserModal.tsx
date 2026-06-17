import { useState } from 'react'
import { X, User, Mail, Lock, ShieldCheck, Loader2, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'

// ─── Types ────────────────────────────────────────────────────────────────────

type NewUserRole = 'teacher' | 'curator' | 'student' | 'admin'

const ROLE_OPTIONS: { value: NewUserRole; label: string; desc: string; color: string }[] = [
  {
    value: 'teacher',
    label: 'Преподаватель',
    desc: 'Ведёт уроки, проверяет ДЗ, выставляет посещаемость',
    color: 'border-green-300 bg-green-50 text-green-700',
  },
  {
    value: 'curator',
    label: 'Куратор',
    desc: 'Сопровождает группу, контролирует прогресс учеников',
    color: 'border-yellow-300 bg-yellow-50 text-yellow-700',
  },
  {
    value: 'student',
    label: 'Ученик',
    desc: 'Проходит курс, сдаёт ДЗ и пробники',
    color: 'border-blue-300 bg-blue-50 text-blue-700',
  },
  {
    value: 'admin',
    label: 'Администратор',
    desc: 'Полный доступ к управлению школой',
    color: 'border-red-300 bg-red-50 text-red-700',
  },
]

interface Props {
  open:      boolean
  onClose:   () => void
  onCreated: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateUserModal({ open, onClose, onCreated }: Props) {
  const [fullName,  setFullName]  = useState('')
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [showPwd,   setShowPwd]   = useState(false)
  const [role,      setRole]      = useState<NewUserRole>('teacher')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [success,   setSuccess]   = useState(false)

  if (!open) return null

  function resetForm() {
    setFullName(''); setEmail(''); setPassword('')
    setRole('teacher'); setError(null); setSuccess(false)
  }

  function handleClose() {
    if (saving) return
    resetForm()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || !email.trim() || !password) return
    setError(null)
    setSaving(true)

    try {
      // Get current session token to pass to edge function
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Сессия истекла, войдите заново'); setSaving(false); return }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            full_name: fullName.trim(),
            email:     email.trim().toLowerCase(),
            password,
            role,
          }),
        }
      )

      const data = await res.json()

      if (!res.ok || data.error) {
        setError(data.error || 'Ошибка создания пользователя')
      } else {
        setSuccess(true)
        setTimeout(() => {
          onCreated()
          handleClose()
        }, 1500)
      }
    } catch (err: any) {
      setError(err.message || 'Сетевая ошибка')
    } finally {
      setSaving(false)
    }
  }

  const selectedRoleMeta = ROLE_OPTIONS.find(r => r.value === role)!

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Создать пользователя</h2>
            <p className="text-xs text-gray-400 mt-0.5">Новый аккаунт без email-подтверждения</p>
          </div>
          <button onClick={handleClose} disabled={saving}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">

          {success ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-center">
              <CheckCircle2 size={44} className="text-green-500" />
              <div>
                <div className="font-semibold text-gray-900">Пользователь создан!</div>
                <div className="text-sm text-gray-500 mt-1">{fullName} · {email}</div>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Role selector */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                  Роль
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRole(opt.value)}
                      className={cn(
                        'text-left px-3 py-2.5 rounded-xl border-2 transition-all',
                        role === opt.value
                          ? opt.color + ' border-opacity-100'
                          : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-gray-200'
                      )}
                    >
                      <div className="text-sm font-semibold">{opt.label}</div>
                      <div className="text-[11px] opacity-70 mt-0.5 leading-tight">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Full name */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  ФИО
                </label>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Иванов Иван Иванович"
                    required
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="user@example.ru"
                    required
                    className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  Пароль
                </label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Минимум 6 символов"
                    minLength={6}
                    required
                    className="w-full pl-9 pr-10 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300"
                  />
                  <button type="button" onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  Сообщите пользователю пароль — он сможет изменить его в настройках
                </p>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                  <ShieldCheck size={15} className="shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleClose} disabled={saving}
                  className="flex-1 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50">
                  Отмена
                </button>
                <button type="submit" disabled={saving || !fullName.trim() || !email.trim() || password.length < 6}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-bold text-white rounded-xl transition-colors',
                    saving || !fullName.trim() || !email.trim() || password.length < 6
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-primary-600 hover:bg-primary-700'
                  )}>
                  {saving
                    ? <><Loader2 size={15} className="animate-spin" />Создаём…</>
                    : <>Создать {selectedRoleMeta.label.toLowerCase()}</>
                  }
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
