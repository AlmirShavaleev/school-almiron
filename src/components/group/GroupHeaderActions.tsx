import { Pencil, CalendarPlus, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import type { GroupMeta } from '@/hooks/useGroupControl'

export function GroupHeaderActions({
  group, canManage, canTeach, onEdit, onAddLesson, onArchiveToggle, onDelete,
}: {
  group: GroupMeta
  canManage: boolean   // admin/owner
  canTeach: boolean    // teacher/admin/owner
  onEdit: () => void
  onAddLesson: () => void
  onArchiveToggle: () => void
  onDelete: () => void
}) {
  const btn = 'flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-colors'
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canManage && (
        <button onClick={onEdit} className={`${btn} bg-white border-gray-200 text-gray-700 hover:bg-gray-50`}>
          <Pencil size={14} />Редактировать
        </button>
      )}
      {canTeach && (
        <button onClick={onAddLesson} className={`${btn} bg-white border-gray-200 text-gray-700 hover:bg-gray-50`}>
          <CalendarPlus size={14} />Занятие
        </button>
      )}
      {canManage && (
        <>
          <button onClick={onArchiveToggle} className={`${btn} bg-white border-gray-200 text-gray-600 hover:bg-gray-50`}>
            {group.is_active ? <><Archive size={14} />Архивировать</> : <><ArchiveRestore size={14} />Восстановить</>}
          </button>
          <button onClick={onDelete} className={`${btn} bg-white border-red-200 text-red-600 hover:bg-red-50`}>
            <Trash2 size={14} />Удалить
          </button>
        </>
      )}
    </div>
  )
}
