import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, UserPlus, UserMinus, ExternalLink, ArrowLeftRight, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import type { GroupStudent } from '@/hooks/useGroupControl'

export function StudentManager({
  students, groupId, max, canManage, onAdd, onTransfer, onChanged,
}: {
  students: GroupStudent[]
  groupId: string
  max: number
  canManage: boolean
  onAdd: () => void
  onTransfer: (s: GroupStudent) => void
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [removing, setRemoving] = useState<string | null>(null)

  async function remove(s: GroupStudent) {
    if (!confirm(`Убрать ${s.full_name} из группы?`)) return
    setRemoving(s.id)
    const { error } = await supabase.from('group_students').delete().eq('group_id', groupId).eq('student_id', s.id)
    setRemoving(null)
    if (error) { alert(error.message); return }
    onChanged()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users size={17} />Ученики
          <span className="text-xs font-normal text-gray-400">{students.length}/{max}</span>
        </CardTitle>
        {canManage && (
          <button onClick={onAdd} className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
            <UserPlus size={13} />Добавить
          </button>
        )}
      </CardHeader>
      {students.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">В группе нет учеников</p>
      ) : (
        <div className="space-y-1.5 max-h-[360px] overflow-y-auto">
          {students.map(s => (
            <div key={s.id} className="flex items-center gap-3 p-2 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors group">
              <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden">
                {s.avatar_url ? <img src={s.avatar_url} className="w-full h-full object-cover" alt="" /> : s.full_name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{s.full_name}</div>
                <div className="text-xs text-gray-400 truncate">{s.email}</div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => navigate(`/students/${s.id}`)} title="Профиль"
                  className="p-1.5 text-gray-400 border border-gray-200 rounded-lg hover:text-primary-600 hover:border-primary-300 transition-colors">
                  <ExternalLink size={12} />
                </button>
                {canManage && (
                  <>
                    <button onClick={() => onTransfer(s)} title="Перевести в другую группу"
                      className="p-1.5 text-gray-400 border border-gray-200 rounded-lg hover:text-blue-600 hover:border-blue-300 transition-colors">
                      <ArrowLeftRight size={12} />
                    </button>
                    <button onClick={() => remove(s)} disabled={removing === s.id} title="Убрать"
                      className="p-1.5 text-red-400 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors">
                      {removing === s.id ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
