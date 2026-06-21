import { useEffect, useState } from 'react'
import { AlertTriangle, Archive, Loader2, Trash2, Users, Calendar, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Props {
  open:       boolean
  groupId:    string
  groupName:  string
  onClose:    () => void
  onArchived: () => void
  onDeleted:  () => void
}

export function ArchiveGroupModal({ open, groupId, groupName, onClose, onArchived, onDeleted }: Props) {
  const [counts,    setCounts]    = useState<{ students: number; lessons: number } | null>(null)
  const [archiving, setArchiving] = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setCounts(null); setError(null)
    Promise.all([
      supabase.from('group_students').select('student_id', { count: 'exact', head: true }).eq('group_id', groupId),
      supabase.from('lessons').select('id', { count: 'exact', head: true }).eq('group_id', groupId),
    ]).then(([gs, ls]) => {
      setCounts({ students: gs.count ?? 0, lessons: ls.count ?? 0 })
    })
  }, [open, groupId])

  async function handleArchive() {
    setArchiving(true); setError(null)
    try {
      const { error: e } = await supabase.from('groups').update({ is_active: false } as any).eq('id', groupId)
      if (e) throw e
      onArchived()
      onClose()
    } catch (e: any) { setError(e.message) } finally { setArchiving(false) }
  }

  async function handleDelete() {
    if (!counts || counts.students > 0 || counts.lessons > 0) return
    setDeleting(true); setError(null)
    try {
      const { error: e } = await supabase.from('groups').delete().eq('id', groupId)
      if (e) throw e
      onDeleted()
      onClose()
    } catch (e: any) { setError(e.message) } finally { setDeleting(false) }
  }

  if (!open) return null
  const isEmpty = counts !== null && counts.students === 0 && counts.lessons === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center shrink-0">
              <AlertTriangle size={20} className="text-orange-500" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Архивировать группу?</h2>
              <p className="text-xs text-gray-400 mt-0.5 truncate max-w-56">«{groupName}»</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          {counts === null ? (
            <div className="flex items-center justify-center py-4 text-gray-400 gap-2">
              <Loader2 size={16} className="animate-spin" />Загрузка данных…
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2.5 p-3 bg-blue-50 rounded-xl border border-blue-100">
                <Users size={16} className="text-blue-500 shrink-0" />
                <div>
                  <div className="font-bold text-gray-900">{counts.students}</div>
                  <div className="text-xs text-gray-500">учеников</div>
                </div>
              </div>
              <div className="flex items-center gap-2.5 p-3 bg-purple-50 rounded-xl border border-purple-100">
                <Calendar size={16} className="text-purple-500 shrink-0" />
                <div>
                  <div className="font-bold text-gray-900">{counts.lessons}</div>
                  <div className="text-xs text-gray-500">занятий</div>
                </div>
              </div>
            </div>
          )}

          {/* Archive consequence */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-3.5 space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-green-800">
              <Archive size={14} />
              Архивирование (рекомендуется)
            </div>
            <ul className="text-xs text-green-700 space-y-0.5 ml-5 list-disc">
              <li>Ученики, занятия и сдачи сохраняются</li>
              <li>Группа скрывается из активных</li>
              <li>Можно восстановить в любой момент</li>
            </ul>
          </div>

          {/* Delete warning — only if not empty */}
          {counts && !isEmpty && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-red-700">
                <Trash2 size={14} />
                Физическое удаление недоступно
              </div>
              <p className="text-xs text-red-600 mt-1">
                В группе есть ученики или занятия. Сначала архивируйте, перенесите учеников, затем удалите.
              </p>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            disabled={archiving || deleting}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2"
          >
            Отмена
          </button>

          <div className="flex items-center gap-2">
            {counts !== null && isEmpty && (
              <button
                onClick={handleDelete}
                disabled={deleting || archiving}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-xl hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Удалить
              </button>
            )}
            <button
              onClick={handleArchive}
              disabled={archiving || deleting || counts === null}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white bg-orange-500 hover:bg-orange-600 rounded-xl disabled:opacity-50 transition-colors"
            >
              {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
              Архивировать
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
