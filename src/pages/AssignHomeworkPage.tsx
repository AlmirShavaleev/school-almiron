import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Send, Users, User, CalendarClock, CheckCircle2 } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/authStore'
import { useCollections } from '@/hooks/useCollections'
import { useCreateAssignment } from '@/hooks/useAssignments'
import { supabase } from '@/lib/supabase'

interface GroupOption {
  id:   string
  name: string
}

interface StudentOption {
  id:        string
  full_name: string
}

export function AssignHomeworkPage() {
  const profile = useAuthStore(s => s.profile)
  const { collections, loading: collectionsLoading } = useCollections()
  const { create, loading: creating, error: createError } = useCreateAssignment()

  const [collectionId, setCollectionId] = useState('')
  const [targetType,   setTargetType]   = useState<'student' | 'group'>('group')
  const [groupId,      setGroupId]      = useState('')
  const [studentId,    setStudentId]    = useState('')
  const [dueDate,      setDueDate]      = useState('')
  const [groups,       setGroups]       = useState<GroupOption[]>([])
  const [students,     setStudents]     = useState<StudentOption[]>([])
  const [loadingTargets, setLoadingTargets] = useState(true)
  const [success,      setSuccess]      = useState(false)

  useEffect(() => {
    if (!profile) return
    let cancelled = false

    async function loadTargets() {
      setLoadingTargets(true)
      const { data: teacher } = await supabase
        .from('teachers').select('id').eq('profile_id', profile!.id).maybeSingle()

      let groupQuery = supabase.from('groups').select('id, name').eq('is_active', true).order('name')
      if (teacher) groupQuery = groupQuery.eq('teacher_id', teacher.id)
      const { data: groupRows } = await groupQuery
      if (cancelled) return
      setGroups((groupRows ?? []) as GroupOption[])

      const groupIds = (groupRows ?? []).map((g: GroupOption) => g.id)
      if (!groupIds.length) { setStudents([]); setLoadingTargets(false); return }

      const { data: memberRows } = await supabase
        .from('group_students')
        .select('student_id, students(id, profiles(full_name))')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .in('group_id', groupIds as any)

      if (cancelled) return
      const byId = new Map<string, StudentOption>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const row of (memberRows ?? []) as any[]) {
        const full_name = row.students?.profiles?.full_name || 'Без имени'
        byId.set(row.student_id, { id: row.student_id, full_name })
      }
      setStudents([...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru')))
      setLoadingTargets(false)
    }

    loadTargets()
    return () => { cancelled = true }
  }, [profile])

  async function handleAssign() {
    setSuccess(false)
    if (!collectionId) return
    const ok = await create({
      collection_id: collectionId,
      student_id: targetType === 'student' ? studentId : null,
      group_id:   targetType === 'group'   ? groupId   : null,
      due_date:   dueDate ? new Date(dueDate).toISOString() : null,
    })
    if (ok) {
      setSuccess(true)
      setCollectionId('')
      setGroupId('')
      setStudentId('')
      setDueDate('')
    }
  }

  const targetValid = targetType === 'student' ? !!studentId : !!groupId
  const canAssign = !!collectionId && targetValid && !creating

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Назначение работ</h1>
        <p className="text-sm text-gray-500 mt-1">Выдайте подборку задач ученику или группе</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Новое назначение</CardTitle>
        </CardHeader>

        <div className="space-y-4">
          {/* Collection select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Подборка задач</label>
            {collectionsLoading ? (
              <p className="text-sm text-gray-400">Загрузка…</p>
            ) : collections.length === 0 ? (
              <p className="text-sm text-gray-400">
                Нет подборок. <Link to="/catalog" className="text-blue-600 hover:underline">Создайте её в каталоге</Link>.
              </p>
            ) : (
              <select
                value={collectionId}
                onChange={e => setCollectionId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">Выберите подборку…</option>
                {collections.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            )}
          </div>

          {/* Target type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Кому назначить</label>
            <div className="flex gap-2">
              <button
                onClick={() => setTargetType('group')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  targetType === 'group' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
                }`}
              >
                <Users size={15} /> Группе
              </button>
              <button
                onClick={() => setTargetType('student')}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  targetType === 'student' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'
                }`}
              >
                <User size={15} /> Ученику
              </button>
            </div>
          </div>

          {loadingTargets ? (
            <p className="text-sm text-gray-400">Загрузка получателей…</p>
          ) : targetType === 'group' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Группа</label>
              {groups.length === 0 ? (
                <p className="text-sm text-gray-400">Нет доступных групп</p>
              ) : (
                <select
                  value={groupId}
                  onChange={e => setGroupId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Выберите группу…</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Ученик</label>
              {students.length === 0 ? (
                <p className="text-sm text-gray-400">Нет доступных учеников</p>
              ) : (
                <select
                  value={studentId}
                  onChange={e => setStudentId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Выберите ученика…</option>
                  {students.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Due date */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
              <CalendarClock size={14} /> Дедлайн (необязательно)
            </label>
            <input
              type="datetime-local"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {createError && <p className="text-sm text-red-600">{createError}</p>}
          {success && (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
              <CheckCircle2 size={16} /> Работа назначена
            </div>
          )}

          <Button onClick={handleAssign} disabled={!canAssign} loading={creating} className="w-full">
            <Send size={16} /> Назначить
          </Button>
        </div>
      </Card>
    </div>
  )
}
