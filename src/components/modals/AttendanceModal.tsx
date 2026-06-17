import { useState, useEffect } from 'react'
import { X, Check, X as XIcon, Clock, Loader2, Save, ChevronDown, Users } from 'lucide-react'
import { useAttendance, type AttendanceStatus, type StudentWithAttendance } from '@/hooks/useAttendance'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

interface Props {
  open:      boolean
  onClose:   () => void
  onSaved:   () => void
  lesson: {
    id:       string
    title:    string
    group_id: string
    scheduled_at: string
  } | null
}

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; icon: React.ReactNode; btn: string; active: string }> = {
  present: {
    label:  'Присутствует',
    icon:   <Check size={14} />,
    btn:    'border-gray-200 text-gray-400 hover:border-green-400 hover:text-green-600',
    active: 'border-green-500 bg-green-50 text-green-700',
  },
  absent: {
    label:  'Отсутствует',
    icon:   <XIcon size={14} />,
    btn:    'border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-600',
    active: 'border-red-400 bg-red-50 text-red-600',
  },
  late: {
    label:  'Опоздал',
    icon:   <Clock size={14} />,
    btn:    'border-gray-200 text-gray-400 hover:border-orange-400 hover:text-orange-600',
    active: 'border-orange-400 bg-orange-50 text-orange-600',
  },
}

export function AttendanceModal({ open, onClose, onSaved, lesson }: Props) {
  const { students, loading, saveAll } = useAttendance(
    open ? lesson?.id ?? null : null,
    open ? lesson?.group_id ?? null : null,
  )

  const [local, setLocal] = useState<StudentWithAttendance[]>([])
  const [saving, setSaving] = useState(false)
  const [expandNote, setExpandNote] = useState<string | null>(null)

  // Sync local state when students load
  useEffect(() => { setLocal(students) }, [students])

  function setStatus(studentId: string, status: AttendanceStatus) {
    setLocal(prev => prev.map(s => s.student_id === studentId ? { ...s, status } : s))
  }

  function setNote(studentId: string, note: string) {
    setLocal(prev => prev.map(s => s.student_id === studentId ? { ...s, note } : s))
  }

  function markAll(status: AttendanceStatus) {
    setLocal(prev => prev.map(s => ({ ...s, status })))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await saveAll(local)
      onSaved()
      onClose()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open || !lesson) return null

  const presentCount = local.filter(s => s.status === 'present').length
  const absentCount  = local.filter(s => s.status === 'absent').length
  const lateCount    = local.filter(s => s.status === 'late').length
  const total = local.length

  const lessonDate = new Date(lesson.scheduled_at).toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col z-10">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">Посещаемость</h2>
            <p className="text-xs text-gray-400 mt-0.5">{lesson.title} · {lessonDate}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3">
            <X size={20} />
          </button>
        </div>

        {/* Quick stats + mark-all */}
        <div className="px-6 py-3 border-b border-gray-100 shrink-0 flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-green-600 font-medium">
              <Check size={14} />{presentCount}
            </span>
            <span className="flex items-center gap-1.5 text-red-500 font-medium">
              <XIcon size={14} />{absentCount}
            </span>
            <span className="flex items-center gap-1.5 text-orange-500 font-medium">
              <Clock size={14} />{lateCount}
            </span>
            <span className="text-gray-300">|</span>
            <span className="flex items-center gap-1 text-gray-400 text-xs">
              <Users size={12} />{total} чел.
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400 mr-1">Все:</span>
            {(['present', 'absent', 'late'] as AttendanceStatus[]).map(s => (
              <button
                key={s}
                onClick={() => markAll(s)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                  STATUS_CONFIG[s].btn
                )}
              >
                {STATUS_CONFIG[s].label.split('т')[0]}т
              </button>
            ))}
          </div>
        </div>

        {/* Student list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" />Загрузка…
            </div>
          ) : local.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Users size={36} className="mx-auto mb-2 opacity-30" />
              <p>В группе нет студентов</p>
            </div>
          ) : (
            local.map(student => (
              <div key={student.student_id} className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold text-sm shrink-0">
                    {student.avatar_url
                      ? <img src={student.avatar_url} className="w-full h-full rounded-full object-cover" />
                      : student.full_name.charAt(0)
                    }
                  </div>

                  {/* Name */}
                  <span className="flex-1 text-sm font-medium text-gray-800">{student.full_name}</span>

                  {/* Status toggles */}
                  <div className="flex items-center gap-1.5">
                    {(['present', 'absent', 'late'] as AttendanceStatus[]).map(s => (
                      <button
                        key={s}
                        title={STATUS_CONFIG[s].label}
                        onClick={() => setStatus(student.student_id, s)}
                        className={cn(
                          'w-8 h-8 rounded-lg border flex items-center justify-center transition-all',
                          student.status === s
                            ? STATUS_CONFIG[s].active
                            : STATUS_CONFIG[s].btn
                        )}
                      >
                        {STATUS_CONFIG[s].icon}
                      </button>
                    ))}
                  </div>

                  {/* Note toggle */}
                  <button
                    onClick={() => setExpandNote(expandNote === student.student_id ? null : student.student_id)}
                    className={cn(
                      'p-1.5 rounded-lg border transition-colors text-xs',
                      student.note
                        ? 'border-primary-300 text-primary-600 bg-primary-50'
                        : 'border-gray-200 text-gray-300 hover:text-gray-500'
                    )}
                    title="Заметка"
                  >
                    <ChevronDown
                      size={13}
                      className={cn('transition-transform', expandNote === student.student_id && 'rotate-180')}
                    />
                  </button>
                </div>

                {/* Note input */}
                {expandNote === student.student_id && (
                  <div className="px-4 pb-3">
                    <input
                      type="text"
                      value={student.note}
                      onChange={e => setNote(student.student_id, e.target.value)}
                      placeholder="Заметка (причина, опоздание на N мин…)"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      autoFocus
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between">
          <div className="text-xs text-gray-400">
            {presentCount} из {total} присутствуют
            {total > 0 && (
              <span className="ml-2 font-semibold text-gray-600">
                ({Math.round(presentCount / total * 100)}%)
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Отмена</Button>
            <Button size="sm" onClick={handleSave} loading={saving}>
              <Save size={14} className="mr-1" />Сохранить
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
