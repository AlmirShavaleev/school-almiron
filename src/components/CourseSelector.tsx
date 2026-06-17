import { useState, useRef, useEffect } from 'react'
import { ChevronDown, BookOpen, Check, Calendar, Lock, Clock } from 'lucide-react'
import { cn } from '@/utils/cn'
import type { StudentCourse } from '@/hooks/useStudentCourses'

interface Props {
  courses:    StudentCourse[]
  activeId:   string | null
  onSelect:   (id: string) => void
  className?: string
  /** Compact variant used in headers */
  compact?:   boolean
}

const STATUS_META: Record<string, { label: string; cls: string; icon?: React.ReactNode }> = {
  active:    { label: 'Активен',   cls: 'bg-green-100 text-green-700' },
  trial:     { label: 'Триал',     cls: 'bg-blue-100 text-blue-700' },
  expired:   { label: 'Истёк',     cls: 'bg-gray-100 text-gray-500',  icon: <Lock size={11} /> },
  cancelled: { label: 'Отменён',   cls: 'bg-gray-100 text-gray-500' },
}

const SUBJECT_LABEL: Record<string, string> = { physics: 'Физика', math: 'Математика' }

export function CourseSelector({ courses, activeId, onSelect, className, compact }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const active = courses.find(c => c.id === activeId)

  if (courses.length === 0) return null

  // Single course — no dropdown
  if (courses.length === 1 && active) {
    return (
      <div className={cn('inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary-50 border border-primary-100', className)}>
        <BookOpen size={14} className="text-primary-600 shrink-0" />
        <div className="text-sm font-medium text-gray-900 truncate">{active.course_title}</div>
      </div>
    )
  }

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
          {active ? (
            <>
              <div className={cn('font-semibold text-gray-900 truncate', compact ? 'text-sm' : 'text-base')}>
                {active.course_title}
              </div>
              {!compact && (
                <div className="text-xs text-gray-500 truncate">
                  {active.course_subject && SUBJECT_LABEL[active.course_subject]}
                  {active.course_exam_type && ` · ${active.course_exam_type.toUpperCase()}`}
                </div>
              )}
            </>
          ) : (
            <span className="text-sm text-gray-400">Выберите курс</span>
          )}
        </div>
        {courses.length > 1 && (
          <>
            <span className="text-xs text-gray-400 shrink-0">{courses.length}</span>
            <ChevronDown size={15} className={cn('text-gray-400 transition-transform shrink-0', open && 'rotate-180')} />
          </>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-50 max-h-96 overflow-y-auto min-w-[280px]">
          <div className="p-1.5">
            {courses.map(c => {
              const meta = STATUS_META[c.status]
              const isActive = c.id === activeId
              return (
                <button
                  key={c.id}
                  onClick={() => { onSelect(c.id); setOpen(false) }}
                  className={cn(
                    'w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
                    isActive ? 'bg-primary-50' : 'hover:bg-gray-50'
                  )}
                >
                  <div className="w-5 h-5 mt-0.5 shrink-0 flex items-center justify-center">
                    {isActive
                      ? <Check size={15} className="text-primary-600" />
                      : <BookOpen size={14} className="text-gray-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn('font-medium text-sm truncate', isActive && 'text-primary-700')}>
                        {c.course_title}
                      </span>
                      {meta && (
                        <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0', meta.cls)}>
                          {meta.icon}{meta.label}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {c.course_subject && SUBJECT_LABEL[c.course_subject]}
                      {c.course_exam_type && ` · ${c.course_exam_type.toUpperCase()}`}
                    </div>
                    {c.expires_at && (
                      <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
                        <Clock size={10} />до {new Date(c.expires_at).toLocaleDateString('ru-RU')}
                      </div>
                    )}
                    {c.course_start_date && c.course_end_date && (
                      <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
                        <Calendar size={10} />
                        {new Date(c.course_start_date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}
                        {' — '}
                        {new Date(c.course_end_date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
