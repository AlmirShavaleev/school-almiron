import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, GraduationCap, User, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { impersonate } from '@/lib/demo'
import { cn } from '@/utils/cn'

interface DemoUser { user_id: string; label: string; role: string; sort: number }

/** Блок «Быстрый вход» — impersonation демо-пользователей. Только admin/owner (RLS на demo_users). */
export function QuickLogin() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<DemoUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    ;(supabase as any).from('demo_users').select('user_id, label, role, sort').order('sort')
      .then(({ data }: any) => { setUsers((data || []) as DemoUser[]); setLoading(false) })
  }, [])

  async function enter(u: DemoUser) {
    setBusy(u.user_id); setErr('')
    try {
      await impersonate(u.user_id, u.label)
      navigate('/dashboard')
    } catch (e: any) {
      setErr(e.message || 'Не удалось войти')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return null
  if (users.length === 0) return null

  const teachers = users.filter(u => u.role === 'teacher')
  const students = users.filter(u => u.role === 'student')

  const Btn = (u: DemoUser, icon: React.ReactNode) => (
    <button
      key={u.user_id}
      onClick={() => enter(u)}
      disabled={!!busy}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-colors disabled:opacity-50',
        'bg-white border-gray-200 text-gray-700 hover:border-primary-300 hover:bg-primary-50'
      )}
    >
      {busy === u.user_id ? <Loader2 size={14} className="animate-spin" /> : icon}
      {u.label}
    </button>
  )

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={16} className="text-amber-600" />
        <h3 className="font-bold text-amber-800 text-sm">Быстрый вход (демо)</h3>
        <span className="text-xs text-amber-600">вход без пароля для тестирования</span>
      </div>

      {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {teachers.map(u => Btn(u, <GraduationCap size={14} className="text-green-600" />))}
        </div>
        <div className="flex flex-wrap gap-2">
          {students.map(u => Btn(u, <User size={14} className="text-blue-500" />))}
        </div>
      </div>
    </div>
  )
}
