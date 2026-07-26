import { useState, useRef, useEffect } from 'react'
import { ChevronDown, BookOpen, Users } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { MyCourseMembership } from '@/hooks/useMyCourseMemberships'

interface Props {
  courses: MyCourseMembership[]
  /** Navigate to a specific group's course page (/my-course/:groupId). */
  onOpenGroup: (groupId: string) => void
  className?: string
  /** Compact variant used in headers */
  compact?: boolean
}

const SUBJECT_LABEL: Record<string, string> = { physics: 'Физика', math: 'Математика' }
const GROUP_TYPE_LABEL: Record<string, string> = { individual: 'Индивидуально', pair: 'Пара', group: 'Мини-группа' }

export function CourseSelector({ courses, onOpenGroup, className, compact }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  if (courses.length === 0) return null

  // Single course, single group -- no dropdown, just a direct link.
  if (courses.length === 1 && courses[0].groups.length === 1) {
    const course = courses[0]
    return (
      <button
        onClick={() => onOpenGroup(course.primaryGroupId)}
        className={cn('inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary-50 border border-primary-100 hover:border-primary-300 transition-colors text-left', className)}
      >
        <BookOpen size={14} className="text-primary-600 shrink-0" />
        <div className="text-sm font-medium text-gray-900 truncate">{course.title}</div>
      </button>
    )
  }

  const totalGroups = courses.reduce((n, c) => n + c.groups.length, 0)

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-2 rounded-xl border transition-colors w-full',
          compact ? 'px-3 py-2 bg-white border-gray-200 hover:border-primary-300'
                  : 'px-4 py-3 bg-white border-gray-200 hover:border-primary-300'
        )}
      >
        <BookOpen size={15} className="text-primary-600 shrink-0" />
        <div className="flex-1 min-w-0 text-left">
          <div className={cn('font-semibold text-gray-900', compact ? 'text-sm' : 'text-base')}>
            {courses.length} курс{courses.length === 1 ? '' : courses.length < 5 ? 'а' : 'ов'} · {totalGroups} групп{totalGroups === 1 ? 'а' : totalGroups < 5 ? 'ы' : ''}
          </div>
          {!compact && <div className="text-xs text-gray-500">Выберите курс, чтобы открыть</div>}
        </div>
        <ChevronDown size={15} className={cn('text-gray-400 transition-transform shrink-0', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto min-w-[280px]">
          <div className="p-1.5">
            {courses.map(c => (
              <div key={c.courseId} className="rounded-lg">
                <div className="px-3 pt-2 pb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900 truncate">{c.title}</span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {c.subject && SUBJECT_LABEL[c.subject]}
                    {c.examType && ` · ${c.examType.toUpperCase()}`}
                  </div>
                </div>
                {c.groups.map(g => (
                  <button
                    key={g.groupId}
                    onClick={() => { onOpenGroup(g.groupId); setOpen(false) }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-gray-50 transition-colors"
                  >
                    <Users size={13} className="text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-700 truncate flex-1">{g.groupTitle}</span>
                    <span className="text-[10px] font-medium text-gray-400 shrink-0">{GROUP_TYPE_LABEL[g.groupType] || g.groupType}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
