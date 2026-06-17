import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Search, UserPlus, UserMinus, Loader2, Users, Check, ExternalLink } from 'lucide-react'
import { useGroupManagement, type GroupStudent } from '@/hooks/useGroupManagement'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'

interface Props {
  open:      boolean
  onClose:   () => void
  onChanged: () => void
  group: { id: string; name: string; max_students: number } | null
}

function Avatar({ s, size = 8 }: { s: GroupStudent; size?: number }) {
  return (
    <div className={cn(
      `w-${size} h-${size} rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-bold shrink-0 overflow-hidden`,
      size === 8 ? 'text-sm' : 'text-xs'
    )}>
      {s.avatar_url
        ? <img src={s.avatar_url} className="w-full h-full object-cover" alt={s.full_name} />
        : s.full_name.charAt(0)
      }
    </div>
  )
}

export function GroupManagementModal({ open, onClose, onChanged, group }: Props) {
  const navigate = useNavigate()
  const { members, loading, addStudent, removeStudent, searchStudents, reload } = useGroupManagement(
    open ? group?.id ?? null : null
  )

  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<GroupStudent[]>([])
  const [searching, setSearching] = useState(false)
  const [removing,  setRemoving]  = useState<string | null>(null)
  const [adding,    setAdding]    = useState<string | null>(null)
  const [addedIds,  setAddedIds]  = useState<Set<string>>(new Set())
  const searchRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Reset on open
  useEffect(() => {
    if (open) { setQuery(''); setResults([]); setAddedIds(new Set()) }
  }, [open])

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    clearTimeout(searchRef.current)
    setSearching(true)
    searchRef.current = setTimeout(async () => {
      const res = await searchStudents(query)
      setResults(res)
      setSearching(false)
    }, 350)
    return () => clearTimeout(searchRef.current)
  }, [query, members])

  async function handleAdd(student: GroupStudent) {
    setAdding(student.student_id)
    try {
      await addStudent(student.student_id)
      setAddedIds(prev => new Set(prev).add(student.student_id))
      setResults(prev => prev.filter(s => s.student_id !== student.student_id))
      onChanged()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setAdding(null)
    }
  }

  async function handleRemove(studentId: string) {
    if (!confirm('Удалить студента из группы?')) return
    setRemoving(studentId)
    try {
      await removeStudent(studentId)
      onChanged()
    } catch (e: any) {
      alert(e.message)
    } finally {
      setRemoving(null)
    }
  }

  if (!open || !group) return null

  const isFull = members.length >= group.max_students

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col z-10">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">{group.name}</h2>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
              <Users size={11} />
              {members.length} / {group.max_students} студентов
              {isFull && <span className="text-orange-500 font-medium">· Группа заполнена</span>}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3">
            <X size={20} />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-6 py-3 border-b border-gray-100 shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Найти студента по имени…"
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={isFull}
            />
            {searching && (
              <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
            )}
          </div>

          {/* Search results */}
          {results.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {results.map(s => (
                <div key={s.student_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors">
                  <Avatar s={s} size={7} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{s.full_name}</div>
                    <div className="text-xs text-gray-400 truncate">{s.email}</div>
                  </div>
                  {addedIds.has(s.student_id) ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                      <Check size={13} />Добавлен
                    </span>
                  ) : (
                    <button
                      onClick={() => handleAdd(s)}
                      disabled={adding === s.student_id || isFull}
                      className="flex items-center gap-1 px-3 py-1.5 bg-primary-600 text-white text-xs font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                    >
                      {adding === s.student_id
                        ? <Loader2 size={12} className="animate-spin" />
                        : <UserPlus size={12} />
                      }
                      Добавить
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {query.trim() && !searching && results.length === 0 && (
            <p className="text-xs text-gray-400 mt-2 px-1">Студентов не найдено (или все уже в группе)</p>
          )}
        </div>

        {/* Members list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
              <Loader2 size={18} className="animate-spin" />Загрузка…
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Users size={36} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">В группе пока нет студентов</p>
              <p className="text-xs mt-1">Используйте поиск выше чтобы добавить</p>
            </div>
          ) : (
            <>
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
                Участники группы
              </div>
              {members.map(s => (
                <div
                  key={s.student_id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors group"
                >
                  <Avatar s={s} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{s.full_name}</div>
                    <div className="text-xs text-gray-400">{s.email}</div>
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1.5 transition-all">
                    <button
                      onClick={() => { onClose(); navigate(`/students/${s.student_id}`) }}
                      title="Открыть профиль"
                      className="p-1.5 text-gray-400 border border-gray-200 rounded-lg hover:text-primary-600 hover:border-primary-300 transition-colors"
                    >
                      <ExternalLink size={12} />
                    </button>
                    <button
                      onClick={() => handleRemove(s.student_id)}
                      disabled={removing === s.student_id}
                      title="Удалить из группы"
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      {removing === s.student_id
                        ? <Loader2 size={12} className="animate-spin" />
                        : <UserMinus size={12} />
                      }
                      Убрать
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 shrink-0 flex justify-end">
          <Button size="sm" variant="secondary" onClick={onClose}>Закрыть</Button>
        </div>
      </div>
    </div>
  )
}
