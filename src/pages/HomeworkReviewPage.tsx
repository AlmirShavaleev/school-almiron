import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, CheckCircle, Clock, AlertTriangle, Users, Loader2, ChevronRight,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'

interface HwInfo {
  id: string
  title: string
  max_score: number
}

interface StudentRow {
  studentId: string
  name: string
  profileId: string
  status: 'submitted' | 'revision' | 'not_submitted' | 'checked'
  score: number | null
  submittedAt: string | null
}

const STATUS_ORDER: Record<string, number> = { submitted: 0, revision: 1, not_submitted: 2, checked: 3 }

const STATUS_LABEL: Record<string, { label: string; color: string; dot: string }> = {
  submitted:     { label: 'Ожидает проверки', color: 'text-orange-500', dot: 'bg-orange-400' },
  revision:      { label: 'На доработке',     color: 'text-yellow-600', dot: 'bg-yellow-400' },
  not_submitted: { label: 'Не сдал',          color: 'text-gray-400',   dot: 'bg-gray-200'   },
  checked:       { label: 'Проверено',         color: 'text-green-600',  dot: 'bg-green-400'  },
}

export function HomeworkReviewPage() {
  const { id, groupId } = useParams<{ id: string; groupId: string }>()
  const navigate = useNavigate()

  const [hw,      setHw]      = useState<HwInfo | null>(null)
  const [students, setStudents] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (id && groupId) loadAll() }, [id, groupId])

  async function loadAll() {
    if (!id || !groupId) return
    setLoading(true)
    try {
      const { data: hwData } = await supabase
        .from('homeworks')
        .select('id, title, max_score')
        .eq('id', id)
        .single()
      setHw(hwData)
      if (!hwData) return

      // Список учеников — из выбранной группы (контекст проверки)
      const [subsRes, gsRes] = await Promise.all([
        supabase
          .from('homework_submissions')
          .select('id, student_id, status, score, submitted_at')
          .eq('homework_id', id),
        supabase
          .from('group_students')
          .select('student_id, students(id, profile_id, profiles(full_name))')
          .eq('group_id', groupId),
      ])

      const subMap: Record<string, any> = {}
      for (const s of (subsRes.data || []) as any[]) subMap[s.student_id] = s

      const list: StudentRow[] = ((gsRes.data || []) as any[]).map((gs: any) => {
        const sub = subMap[gs.student_id]
        return {
          studentId:   gs.student_id,
          name:        gs.students?.profiles?.full_name || 'Без имени',
          profileId:   gs.students?.profile_id || '',
          status:      (sub?.status ?? 'not_submitted') as StudentRow['status'],
          score:       sub?.score ?? null,
          submittedAt: sub?.submitted_at ?? null,
        }
      })

      list.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9))
      setStudents(list)
    } finally {
      setLoading(false)
    }
  }

  const checkedCount   = students.filter(s => s.status === 'checked').length
  const pendingCount   = students.filter(s => s.status === 'submitted').length
  const notSubmitted   = students.filter(s => s.status === 'not_submitted').length

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" />Загрузка…
    </div>
  )

  return (
    <div className="max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-gray-900 truncate">{hw?.title}</h1>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
            <span className="flex items-center gap-1"><CheckCircle size={11} className="text-green-500" />{checkedCount} проверено</span>
            <span className="flex items-center gap-1"><Clock size={11} className="text-orange-400" />{pendingCount} ожидают</span>
            {notSubmitted > 0 && <span className="flex items-center gap-1"><AlertTriangle size={11} className="text-red-400" />{notSubmitted} не сдали</span>}
            <span className="text-gray-400">Макс: {hw?.max_score} б.</span>
          </div>
        </div>
      </div>

      {/* Student list */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <Users size={14} className="text-gray-400" />
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ученики ({students.length})</span>
        </div>

        {students.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">Нет учеников в группе</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {students.map(s => {
              const meta = STATUS_LABEL[s.status]
              const canReview = s.status === 'submitted' || s.status === 'revision' || s.status === 'checked'
              return (
                <button
                  key={s.studentId}
                  disabled={!canReview}
                  onClick={() => navigate(`/homeworks/${id}/review/${groupId}/${s.studentId}`)}
                  className={cn(
                    'w-full flex items-center gap-4 px-4 py-3.5 text-left transition-colors',
                    canReview ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default opacity-60'
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    'w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                    s.status === 'checked'       ? 'bg-green-100 text-green-700' :
                    s.status === 'submitted'     ? 'bg-orange-100 text-orange-700' :
                    s.status === 'revision'      ? 'bg-yellow-100 text-yellow-700' :
                                                   'bg-gray-100 text-gray-400'
                  )}>
                    {s.name.charAt(0)}
                  </div>

                  {/* Name + status */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{s.name}</div>
                    <div className={cn('text-xs mt-0.5', meta.color)}>
                      {meta.label}
                      {s.status === 'checked' && s.score != null && ` · ${s.score}/${hw?.max_score} б.`}
                      {s.submittedAt && s.status !== 'not_submitted' && (
                        <span className="text-gray-400 ml-1.5">
                          {new Date(s.submittedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Dot for pending */}
                  {s.status === 'submitted' && (
                    <div className="w-2 h-2 bg-orange-400 rounded-full shrink-0" />
                  )}

                  {/* Arrow for clickable */}
                  {canReview && (
                    <ChevronRight size={15} className="text-gray-300 shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
