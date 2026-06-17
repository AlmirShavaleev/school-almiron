import { useState, useEffect } from 'react'
import { X, Check, Clock, X as XIcon, Loader2, Calendar, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'

interface LessonAttendance {
  lesson_id:    string
  title:        string
  scheduled_at: string
  group_name:   string
  status:       'present' | 'absent' | 'late' | null  // null = не отмечено
  note:         string | null
}

interface Props {
  open:       boolean
  onClose:    () => void
  studentId:  string | null
  studentName: string
}

const STATUS = {
  present: { label: 'Присутствовал', icon: <Check size={14} />,  chip: 'bg-green-100 text-green-700 border-green-200' },
  absent:  { label: 'Отсутствовал',  icon: <XIcon size={14} />,  chip: 'bg-red-100 text-red-600 border-red-200' },
  late:    { label: 'Опоздал',       icon: <Clock size={14} />,  chip: 'bg-orange-100 text-orange-600 border-orange-200' },
  null:    { label: 'Не отмечено',   icon: <Calendar size={14} />, chip: 'bg-gray-100 text-gray-400 border-gray-200' },
}

export function StudentAttendanceModal({ open, onClose, studentId, studentName }: Props) {
  const [rows,    setRows]    = useState<LessonAttendance[]>([])
  const [loading, setLoading] = useState(false)
  const [filter,  setFilter]  = useState<'all' | 'present' | 'absent' | 'late'>('all')

  useEffect(() => {
    if (!open || !studentId) return
    setLoading(true)

    async function load() {
      // Groups this student belongs to
      const { data: gs } = await supabase
        .from('group_students')
        .select('group_id, groups(name)')
        .eq('student_id', studentId!)

      if (!gs?.length) { setRows([]); setLoading(false); return }

      const groupIds   = gs.map((g: any) => g.group_id)
      const groupNames: Record<string, string> = {}
      for (const g of gs) groupNames[(g as any).group_id] = (g as any).groups?.name || '—'

      // All lessons for those groups
      const { data: lessons } = await supabase
        .from('lessons')
        .select('id, title, scheduled_at, group_id')
        .in('group_id', groupIds)
        .order('scheduled_at', { ascending: false })

      // Attendance records for this student
      const lessonIds = (lessons || []).map((l: any) => l.id)
      const { data: att } = await supabase
        .from('attendance')
        .select('lesson_id, status, note')
        .eq('student_id', studentId!)
        .in('lesson_id', lessonIds)

      const attMap: Record<string, { status: string; note: string | null }> = {}
      for (const a of att || []) attMap[a.lesson_id] = a

      const result: LessonAttendance[] = (lessons || []).map((l: any) => ({
        lesson_id:    l.id,
        title:        l.title,
        scheduled_at: l.scheduled_at,
        group_name:   groupNames[l.group_id] || '—',
        status:       (attMap[l.id]?.status as any) || null,
        note:         attMap[l.id]?.note || null,
      }))

      setRows(result)
      setLoading(false)
    }

    load()
  }, [open, studentId])

  if (!open) return null

  const filtered = filter === 'all' ? rows : rows.filter(r => r.status === filter)

  const counts = {
    present: rows.filter(r => r.status === 'present').length,
    absent:  rows.filter(r => r.status === 'absent').length,
    late:    rows.filter(r => r.status === 'late').length,
    total:   rows.filter(r => r.status !== null).length,
  }
  const percent = counts.total > 0
    ? Math.round((counts.present + counts.late) / counts.total * 100)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col z-10">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">{studentName}</h2>
            <p className="text-xs text-gray-400 mt-0.5">История посещаемости</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3">
            <X size={20} />
          </button>
        </div>

        {/* Stats row */}
        {!loading && rows.length > 0 && (
          <div className="px-6 py-3 border-b border-gray-100 shrink-0 flex items-center gap-4">
            <div className="flex-1 flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-green-600 font-semibold">
                <Check size={14} />{counts.present}
              </span>
              <span className="flex items-center gap-1.5 text-orange-500 font-semibold">
                <Clock size={14} />{counts.late}
              </span>
              <span className="flex items-center gap-1.5 text-red-500 font-semibold">
                <XIcon size={14} />{counts.absent}
              </span>
            </div>
            {/* Percent bar */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full', percent >= 80 ? 'bg-green-500' : percent >= 60 ? 'bg-yellow-400' : 'bg-red-400')}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className={cn(
                'text-sm font-bold',
                percent >= 80 ? 'text-green-600' : percent >= 60 ? 'text-yellow-600' : 'text-red-500'
              )}>{percent}%</span>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        {!loading && rows.length > 0 && (
          <div className="flex gap-1 px-6 py-2 border-b border-gray-100 shrink-0">
            {([
              ['all',     'Все',           rows.length],
              ['present', 'Присутствовал', counts.present],
              ['late',    'Опоздал',       counts.late],
              ['absent',  'Отсутствовал',  counts.absent],
            ] as [string, string, number][]).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setFilter(key as any)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  filter === key
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-gray-500 hover:bg-gray-100'
                )}
              >
                {label} <span className="opacity-60 ml-0.5">{count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Lesson list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" />Загрузка…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Calendar size={36} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Нет занятий</p>
            </div>
          ) : (
            filtered.map(row => {
              const s = STATUS[row.status ?? 'null']
              const d = new Date(row.scheduled_at)
              return (
                <div
                  key={row.lesson_id}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  {/* Date */}
                  <div className="shrink-0 w-11 text-center">
                    <div className="text-base font-bold text-gray-900 leading-none">{d.getDate()}</div>
                    <div className="text-[10px] text-gray-400 uppercase mt-0.5">
                      {d.toLocaleDateString('ru-RU', { month: 'short' })}
                    </div>
                  </div>

                  <div className="w-px h-8 bg-gray-100 shrink-0" />

                  {/* Lesson info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{row.title}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-xs text-gray-400">
                      <Users size={10} />
                      {row.group_name}
                      <span>·</span>
                      {d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {row.note && (
                      <div className="mt-1 text-xs text-gray-500 italic">💬 {row.note}</div>
                    )}
                  </div>

                  {/* Status chip */}
                  <span className={cn(
                    'shrink-0 flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border',
                    s.chip
                  )}>
                    {s.icon}{s.label}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
