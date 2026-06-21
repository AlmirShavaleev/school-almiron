import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { GraduationCap, Lock } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'

/**
 * Страница установки нового пароля после перехода по recovery-ссылке из письма.
 * Supabase (detectSessionInUrl) парсит recovery-токен из URL и поднимает временную
 * сессию (событие PASSWORD_RECOVERY). В этой сессии разрешён updateUser({ password }).
 */
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [ready, setReady]   = useState(false)   // есть ли recovery-сессия
  const [checking, setChk]  = useState(true)
  const [newPass, setNew]   = useState('')
  const [confirm, setConf]  = useState('')
  const [loading, setLoad]  = useState(false)
  const [done, setDone]     = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    let cancelled = false

    // Событие восстановления (приходит при разборе токена из URL)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !cancelled) { setReady(true); setChk(false) }
    })

    // Фоллбэк: токен мог быть разобран до подписки — проверяем активную сессию
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      if (session) setReady(true)
      setChk(false)
    })

    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPass.length < 8)                              return setError('Минимум 8 символов')
    if (!/[A-Za-z]/.test(newPass) || !/\d/.test(newPass)) return setError('Пароль должен содержать буквы и цифры')
    if (newPass !== confirm)                             return setError('Пароли не совпадают')

    setLoad(true)
    const { error } = await supabase.auth.updateUser({ password: newPass })
    setLoad(false)
    if (error) { setError(error.message); return }

    setDone(true)
    // Завершаем recovery-сессию и отправляем на вход с новым паролем
    await supabase.auth.signOut()
    setTimeout(() => navigate('/login'), 2500)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <GraduationCap size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Школа Almiron</h1>
          <p className="text-gray-500 mt-1">Новый пароль</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {done ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-3">✅</div>
              <h3 className="font-semibold text-gray-900">Пароль изменён!</h3>
              <p className="text-gray-500 text-sm mt-1">Перенаправляем на страницу входа…</p>
            </div>
          ) : checking ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !ready ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-3">⚠️</div>
              <h3 className="font-semibold text-gray-900">Ссылка недействительна</h3>
              <p className="text-gray-500 text-sm mt-1">
                Ссылка для сброса пароля устарела или уже использована. Запросите новую.
              </p>
              <Link to="/forgot-password" className="mt-4 inline-block text-primary-600 text-sm">
                Запросить новую ссылку
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Установите новый пароль</h2>
              <p className="text-gray-500 text-sm mb-6">Минимум 8 символов, буквы и цифры.</p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label="Новый пароль" type="password" placeholder="••••••••"
                  icon={<Lock size={16} />} value={newPass}
                  onChange={e => setNew(e.target.value)} required
                />
                <Input
                  label="Повторите пароль" type="password" placeholder="••••••••"
                  icon={<Lock size={16} />} value={confirm}
                  onChange={e => setConf(e.target.value)} required
                />
                <Button type="submit" loading={loading} className="w-full" size="lg">
                  Сменить пароль
                </Button>
              </form>

              <div className="mt-6 text-center text-sm text-gray-500">
                <Link to="/login" className="text-primary-600 hover:text-primary-700 font-medium">← Вернуться к входу</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
