import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { GraduationCap, User, Mail, Lock } from 'lucide-react'
import { Input, Select } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { getPendingInvitePath, hasPendingInvite } from '@/lib/studentInviteSession'
import { getPendingTeacherJoinLinkPath, hasPendingTeacherJoinLink } from '@/lib/teacherJoinLinkSession'

// ФИО обязательно ВСЕГДА, в том числе при переходе по ссылке приглашения.
// Раньше в режиме приглашения поле пряталось: расчёт был на то, что имя
// подставит легаси-RPC из списка преподавателя. Для курсовых ссылок такого
// списка не существует, поэтому имя не приходило ниоткуда — в метаданные
// регистрации уходило пустое значение, и профиль создавался с запасной
// подстановкой из почты (`ismailnur2009` вместо ФИО, трое учеников 12–14.08).
// Пришедший по ссылке от учителя тем более обязан назваться, а сэкономленный
// шаг формы стоил дороже, чем экономил.
const schema = z.object({
  full_name: z.string().refine(v => v.trim().length >= 2, 'Введите ФИО'),
  email: z.string().email('Введите корректный email'),
  password: z.string().min(6, 'Минимум 6 символов'),
  confirm: z.string().min(1, 'Повторите пароль'),
  role: z.enum(['student']),
}).refine(d => d.password === d.confirm, {
  message: 'Пароли не совпадают',
  path: ['confirm'],
})

type FormData = z.infer<typeof schema>

export function RegisterPage() {
  const { signUp } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const inviteMode = hasPendingInvite()

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'student', full_name: '' },
  })

  async function onSubmit(data: FormData) {
    setError('')
    const { data: authData, error } = await signUp(
      data.email,
      data.password,
      data.full_name.trim(),
      data.role,
      {
        skipProfileInsert: inviteMode,
        redirectTo: `${window.location.origin}/`,
      },
    )
    if (error) {
      setError(error.message)
      return
    }
    if (inviteMode && authData.session) {
      navigate(getPendingInvitePath() || '/join')
      return
    }
    if (hasPendingTeacherJoinLink() && authData.session) {
      navigate(getPendingTeacherJoinLinkPath() || '/dashboard')
      return
    }
    setSuccess(true)
    if (!inviteMode && !hasPendingTeacherJoinLink()) {
      setTimeout(() => navigate('/login'), 2000)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <GraduationCap size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Школа Almiron</h1>
          <p className="text-gray-500 mt-1">Регистрация</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {success ? (
            <div className="text-center py-6" data-testid="register-success">
              <div className="text-4xl mb-3">✅</div>
              <h3 className="font-semibold text-gray-900">Регистрация успешна!</h3>
              <p className="text-gray-500 text-sm mt-1">
                {inviteMode
                  ? 'Подтвердите email. После подтверждения приглашение останется доступным.'
                  : hasPendingTeacherJoinLink()
                  ? 'Подтвердите email — после этого заявка преподавателю будет отправлена автоматически.'
                  : 'Проверьте email для подтверждения'}
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Создать аккаунт</h2>

              {inviteMode && (
                <div className="mb-4 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-700">
                  После регистрации вы вернётесь к приглашению. Если нужно подтверждение email, приглашение останется доступным.
                </div>
              )}

              {error && (
                <div data-testid="register-error" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <Input data-testid="register-full-name" label="ФИО" placeholder="Иванов Иван Иванович" icon={<User size={16} />} error={errors.full_name?.message} {...register('full_name')} />
                <Input data-testid="register-email" label="Email" type="email" placeholder="your@email.ru" icon={<Mail size={16} />} error={errors.email?.message} {...register('email')} />
                <Input data-testid="register-password" label="Пароль" type="password" placeholder="••••••••" icon={<Lock size={16} />} error={errors.password?.message} {...register('password')} />
                <Input data-testid="register-password-confirm" label="Повторите пароль" type="password" placeholder="••••••••" icon={<Lock size={16} />} error={errors.confirm?.message} {...register('confirm')} />
                <Select
                  label="Роль"
                  options={[{ value: 'student', label: 'Ученик' }]}
                  {...register('role')}
                />
                <Button data-testid="register-submit" type="submit" loading={isSubmitting} className="w-full" size="lg">
                  Зарегистрироваться
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 text-center text-sm text-gray-500">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-primary-600 hover:text-primary-700 font-medium">Войти</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
