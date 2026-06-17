import { useState } from 'react'
import { Link } from 'react-router-dom'
import { GraduationCap, Mail } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await resetPassword(email)
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-primary-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <GraduationCap size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Школа Almiron</h1>
        </div>
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {sent ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-3">📧</div>
              <h3 className="font-semibold text-gray-900">Письмо отправлено!</h3>
              <p className="text-gray-500 text-sm mt-1">Проверьте почту и следуйте инструкциям</p>
              <Link to="/login" className="mt-4 inline-block text-primary-600 text-sm">← Вернуться к входу</Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-2">Восстановление пароля</h2>
              <p className="text-gray-500 text-sm mb-6">Введите email, и мы отправим ссылку для сброса пароля</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.ru" icon={<Mail size={16} />} required />
                <Button type="submit" loading={loading} className="w-full">Отправить ссылку</Button>
              </form>
              <div className="mt-4 text-center">
                <Link to="/login" className="text-sm text-primary-600">← Вернуться к входу</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
