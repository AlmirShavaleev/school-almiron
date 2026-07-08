import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, Loader2, Send, Users, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/utils/cn'

interface HomeworkTarget {
  id: string
  title: string
  topic_id?: string | null
  max_score?: number | null
}

interface GroupOption {
  id: string
  name: string
  course_id: string | null
}

interface StudentOption {
  id: string
  full_name: string
  group_ids: string[]
}

interface Props {
  open: boolean
  homework: HomeworkTarget | null
  onClose: () => void
  onAssigned: () => void
}

interface AssignSummary {
  assignments_created?: number
  student_assignments_created?: number
  notifications_created?: number
}

export function AssignHomeworkModal({ open, homework, onClose, onAssigned }: Props) {
  const profile = useAuthStore(s => s.profile)
  const [groups, setGroups] = useState<GroupOption[]>([])
  const [students, setStudents] = useState<StudentOption[]>([])
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [selectedStudents, setSelectedStudents] = useState<string[]>([])
  const [availableFrom, setAvailableFrom] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [maxAttempts, setMaxAttempts] = useState(3)
  const [allowLate, setAllowLate] = useState(true)
  const [showSolution, setShowSolution] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<AssignSummary | null>(null)

  useEffect(() => {
    if (!open || !profile) return
    setError('')
    setSummary(null)
    setSelectedGroups([])
    setSelectedStudents([])
    setAvailableFrom('')
    setDueAt('')
    setMaxAttempts(3)
    setAllowLate(true)
    setShowSolution(false)

    async function loadTargets() {
      setLoading(true)
      try {
        let teacherId: string | null = null
        if (profile!.role === 'teacher') {
          const { data: teacher } = await supabase
            .from('teachers')
            .select('id')
            .eq('profile_id', profile!.id)
            .single()
          teacherId = teacher?.id ?? null
        }

        let groupQuery = supabase
          .from('groups')
          .select('id, name, course_id')
          .eq('is_active', true)
          .order('name')

        if (teacherId) groupQuery = groupQuery.eq('teacher_id', teacherId)

        const { data: groupRows, error: groupError } = await groupQuery
        if (groupError) throw groupError

        const loadedGroups = (groupRows || []) as GroupOption[]
        setGroups(loadedGroups)

        const groupIds = loadedGroups.map(g => g.id)
        if (!groupIds.length) {
          setStudents([])
          return
        }

        const { data: memberRows, error: memberError } = await supabase
          .from('group_students')
          .select('group_id, student_id, students(id, profiles(full_name))')
          .in('group_id', groupIds)

        if (memberError) throw memberError

        const byStudent = new Map<string, StudentOption>()
        for (const row of (memberRows || []) as any[]) {
          const studentId = row.student_id
          const existing = byStudent.get(studentId)
          const fullName = row.students?.profiles?.full_name || 'Без имени'
          if (existing) existing.group_ids.push(row.group_id)
          else byStudent.set(studentId, { id: studentId, full_name: fullName, group_ids: [row.group_id] })
        }

        setStudents([...byStudent.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru')))
      } catch (e: any) {
        setError(e.message || 'Не удалось загрузить группы и учеников')
      } finally {
        setLoading(false)
      }
    }

    loadTargets()
  }, [open, profile])

  const uniqueStudentCount = useMemo(() => {
    const ids = new Set<string>()
    for (const student of students) {
      if (student.group_ids.some(groupId => selectedGroups.includes(groupId))) ids.add(student.id)
    }
    selectedStudents.forEach(id => ids.add(id))
    return ids.size
  }, [students, selectedGroups, selectedStudents])

  function toggle(list: string[], id: string, setter: (next: string[]) => void) {
    setter(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  }

  async function assign() {
    if (!homework) return
    if (!selectedGroups.length && !selectedStudents.length) {
      setError('Выберите хотя бы одну группу или ученика')
      return
    }
    if (maxAttempts < 1 || maxAttempts > 20) {
      setError('Количество попыток должно быть от 1 до 20')
      return
    }

    setSubmitting(true)
    setError('')
    setSummary(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('assign_homework' as any, {
        p_homework_id: homework.id,
        p_group_ids: selectedGroups,
        p_student_ids: selectedStudents,
        p_available_from: availableFrom ? new Date(availableFrom).toISOString() : null,
        p_due_at: dueAt ? new Date(dueAt).toISOString() : null,
        p_max_attempts: maxAttempts,
        p_allow_late_submission: allowLate,
        p_show_solution_after_accept: showSolution,
      })
      if (rpcError) throw rpcError
      setSummary((data || {}) as AssignSummary)
      onAssigned()
    } catch (e: any) {
      setError(e.message || 'Не удалось назначить ДЗ')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open || !homework) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary-700">
              <Send size={16} />Назначить домашнее задание
            </div>
            <h2 className="mt-1 truncate text-lg font-bold text-gray-900">{homework.title}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="grid max-h-[calc(90vh-73px)] grid-cols-1 overflow-y-auto lg:grid-cols-[1fr_280px]">
          <div className="space-y-5 p-5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-14 text-gray-400">
                <Loader2 size={18} className="animate-spin" />Загрузка получателей...
              </div>
            ) : (
              <>
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">Группы</h3>
                    <span className="text-xs text-gray-400">{selectedGroups.length} выбрано</span>
                  </div>
                  {groups.length === 0 ? (
                    <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-400">Нет доступных групп</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {groups.map(group => (
                        <label
                          key={group.id}
                          className={cn(
                            'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors',
                            selectedGroups.includes(group.id)
                              ? 'border-primary-300 bg-primary-50 text-primary-800'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={selectedGroups.includes(group.id)}
                            onChange={() => toggle(selectedGroups, group.id, setSelectedGroups)}
                            className="h-4 w-4 accent-primary-600"
                          />
                          <Users size={15} className="shrink-0 text-gray-400" />
                          <span className="truncate">{group.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">Отдельные ученики</h3>
                    <span className="text-xs text-gray-400">{selectedStudents.length} выбрано</span>
                  </div>
                  {students.length === 0 ? (
                    <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-400">Нет доступных учеников</p>
                  ) : (
                    <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-2">
                      {students.map(student => (
                        <label
                          key={student.id}
                          className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={selectedStudents.includes(student.id)}
                            onChange={() => toggle(selectedStudents, student.id, setSelectedStudents)}
                            className="h-4 w-4 accent-primary-600"
                          />
                          <span className="truncate">{student.full_name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>

          <aside className="space-y-4 border-t border-gray-100 bg-gray-50 p-5 lg:border-l lg:border-t-0">
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <CalendarClock size={16} className="text-primary-600" />Параметры
              </div>
              <div className="mt-4 space-y-3">
                <Input
                  label="Открыть с"
                  type="datetime-local"
                  value={availableFrom}
                  onChange={e => setAvailableFrom(e.target.value)}
                />
                <Input
                  label="Дедлайн"
                  type="datetime-local"
                  value={dueAt}
                  onChange={e => setDueAt(e.target.value)}
                />
                <Input
                  label="Попыток"
                  type="number"
                  min={1}
                  max={20}
                  value={maxAttempts}
                  onChange={e => setMaxAttempts(Number(e.target.value))}
                />
                <label className="flex items-start gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={allowLate} onChange={e => setAllowLate(e.target.checked)} className="mt-0.5 accent-primary-600" />
                  Разрешить сдачу после дедлайна
                </label>
                <label className="flex items-start gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={showSolution} onChange={e => setShowSolution(e.target.checked)} className="mt-0.5 accent-primary-600" />
                  Показывать решение после принятия
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-primary-100 bg-primary-50 p-4">
              <div className="text-xs font-medium text-primary-600">Уникальных учеников</div>
              <div className="mt-1 text-3xl font-bold text-primary-800">{uniqueStudentCount}</div>
              <p className="mt-1 text-xs text-primary-500">Повторы через группы и ручной выбор будут дедуплицированы RPC.</p>
            </div>

            {summary && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  <CheckCircle2 size={16} />Назначено
                </div>
                <p>Ученикам: {summary.student_assignments_created ?? 0}</p>
                <p>Уведомлений: {summary.notifications_created ?? 0}</p>
              </div>
            )}

            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={onClose}>Закрыть</Button>
              <Button className="flex-1" onClick={assign} loading={submitting} disabled={loading || uniqueStudentCount === 0}>
                Назначить
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
