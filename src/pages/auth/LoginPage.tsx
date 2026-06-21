import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { GraduationCap, Mail, Lock } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import { demoProfiles } from '@/lib/demo-data'

const schema = z.object({
  email: z.string().email('Введите корректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
})
type FormData = z.infer<typeof schema>

// Demo accounts shown only in non-production builds
const IS_DEV = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO === 'true'

const DEMO_ACCOUNTS = IS_DEV ? [
  { label: 'Ученик',  email: 'alex@demo.ru',      password: 'demo123' },
  { label: 'Учитель', email: 'physics@demo.ru',   password: 'demo123' },
  { label: 'Куратор', email: 'curator@demo.ru',   password: 'demo123' },
  { label: 'Админ',   email: 'admin@demo.ru',     password: 'demo123' },
] : []

export function LoginPage() {
  const { signIn } = useAuth()
  const { setProfile } = useAuthStore()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError('')
    const { error } = await signIn(data.email, data.password)
    if (error) {
      // Demo mode: find demo profile by email
      const demoProfile = demoProfiles.find(p => p.email === data.email)
      if (demoProfile && data.password === 'demo123') {
        setProfile(demoProfile)
        navigate('/dashboard')
      } else if ((error as any).code === 'email_not_confirmed' || /email not confirmed/i.test(error.message)) {
        setError('Email не подтверждён. Проверьте почту и перейдите по ссылке из письма, затем войдите снова.')
      } else {
        setError('Неверный email или пароль')
      }
    } else {
      navigate('/dashboard')
    }
  }

  function loginAsDemo(email: string, password: string) {
    setValue('email', email)
    setValue('password', password)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <GraduationCap size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Школа Almiron</h1>
          <p className="text-gray-500 mt-1">Подготовка к ЕГЭ и ОГЭ</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Вход в систему</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Email"
              type="email"
              placeholder="your@email.ru"
              icon={<Mail size={16} />}
              error={errors.email?.message}
              {...register('email')}
            />
            <Input
              label="Пароль"
              type="password"
              placeholder="••••••••"
              icon={<Lock size={16} />}
              error={errors.password?.message}
              {...register('password')}
            />

            <div className="text-right">
              <Link to="/forgot-password" className="text-sm text-primary-600 hover:text-primary-700">
                Забыли пароль?
              </Link>
            </div>

            <Button type="submit" loading={isSubmitting} className="w-full" size="lg">
              Войти
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            Нет аккаунта?{' '}
            <Link to="/register" className="text-primary-600 hover:text-primary-700 font-medium">
              Зарегистрироваться
            </Link>
          </div>
        </div>

        {/* Demo accounts — only shown in development */}
        {IS_DEV && DEMO_ACCOUNTS.length > 0 && (
        <div className="mt-6 bg-white/80 rounded-2xl p-4 backdrop-blur">
          <p className="text-xs text-gray-500 text-center mb-3 font-medium">ДЕМО-АККАУНТЫ (пароль: demo123)</p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map(acc => (
              <button
                key={acc.email}
                onClick={() => loginAsDemo(acc.email, acc.password)}
                className="px-2 py-1.5 bg-primary-50 hover:bg-primary-100 text-primary-700 text-xs rounded-lg transition-colors font-medium"
              >
                {acc.label}
              </button>
            ))}
          </div>
        </div>
        )}
      </div>
    </div>
  )
}
