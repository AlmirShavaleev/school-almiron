import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, Calendar, BookOpen, Pencil, ArrowRight, Archive } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useAuthStore } from '@/store/authStore'
import { useGroups } from '@/hooks/useGroups'
import { GroupModal } from '@/components/modals/GroupModal'
import { SUBJECT_LABELS, EXAM_LABELS } from '@/utils/format'
import { cn } from '@/utils/cn'

interface GroupForModal {
  id:            string
  name:          string
  course_id:     string | null
  teacher_id:    string | null
  curator_id:    string | null
  max_students:  number
  schedule_days: string[]
  schedule_time: string | null
  is_active:     boolean
}

export function GroupsPage() {
  const navigate  = useNavigate()
  const profile   = useAuthStore(s => s.profile)
  const canManage = !!profile?.role && ['admin', 'owner', 'teacher'].includes(profile.role)
  const canEditOwn = !!profile?.role && ['admin', 'owner', 'teacher'].includes(profile.role)

  const { groups, loading, reload } = useGroups()

  const [modalOpen,   setModalOpen]   = useState(false)
  const [editTarget,  setEditTarget]  = useState<GroupForModal | null>(null)
  const [initialTab,  setInitialTab]  = useState<'settings' | 'students'>('settings')
  const [filter,      setFilter]      = useState<'active' | 'archived' | 'all'>('active')

  function openEdit(g: any, initialTab?: 'settings' | 'students') {
    setEditTarget({
      id:            g.id,
      name:          g.name,
      course_id:     g.course_id || null,
      teacher_id:    g.teacher_id || null,
      curator_id:    g.curator_id || null,
      max_students:  g.max_students || 20,
      schedule_days: g.schedule_days || [],
      schedule_time: g.schedule_time || null,
      is_active:     g.is_active ?? true,
    })
    setInitialTab(initialTab || 'settings')
    setModalOpen(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Загрузка…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="platform-surface rounded-lg p-5 sm:p-6 flex flex-col lg:flex-row items-stretch lg:items-end justify-between gap-5">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100">
            <Users size={13} />
            CRM групп
          </div>
          <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-graphite-950">Группы</h1>
          <p className="text-slate-500 mt-1">Учебные группы школы · {groups.length} групп</p>
          <div className="flex items-center gap-1.5 mt-3">
            {(
              [
                { key: 'active',   label: 'Активные', icon: undefined },
                { key: 'archived', label: 'Архив',     icon: <Archive size={11} /> },
                { key: 'all',      label: 'Все',       icon: undefined },
              ] as Array<{ key: 'active' | 'archived' | 'all'; label: string; icon: React.ReactNode }>
            ).map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'flex min-h-11 sm:min-h-0 items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium border transition-colors',
                  filter === f.key
                    ? 'bg-primary-950 border-primary-950 text-white'
                    : 'bg-white/80 border-slate-200 text-slate-500 hover:border-primary-200 hover:text-primary-700'
                )}
              >
                {f.icon}{f.label}
              </button>
            ))}
          </div>
        </div>
        {/* Кнопки «Создать группу» больше нет: один курс = одна группа, и группа
            заводится вместе с курсом триггером courses_ensure_group (§61).
            Руками создать вторую всё равно не даст unique(course_id). */}
      </div>

      {(() => {
        const filteredGroups = groups.filter(g =>
          filter === 'all' ? true :
          filter === 'active' ? (g.is_active !== false) :
          g.is_active === false
        )

        if (groups.length === 0) return (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-gray-400">
            <Users size={44} className="opacity-25" />
            <p className="text-sm">Пока нет ни одного курса</p>
            {/* Группа заводится вместе с курсом, поэтому пусто здесь может быть
                только когда нет курсов. Звать «создать группу» бессмысленно. */}
          </div>
        )

        return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredGroups.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 gap-3 text-gray-400">
              <Archive size={36} className="opacity-25" />
              <p className="text-sm">{filter === 'archived' ? 'Нет архивных групп' : 'Нет активных групп'}</p>
            </div>
          )}
          {filteredGroups.map(group => {
            const fill        = Math.round((group.student_count / (group.max_students || 1)) * 100)
            const teacherName = group.teachers?.profiles?.full_name
            const courseName  = group.courses?.title
            const subject     = group.courses?.subject
            const examType    = group.courses?.exam_type
            const students    = group.group_students || []
            const curatorName = group.curators?.profiles?.full_name

            return (
              <div key={group.id}
                className="platform-surface rounded-lg hover:border-primary-200 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 flex flex-col">

                {/* Card header */}
                <div className="px-5 pt-5 pb-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <button
                      onClick={() => navigate(`/groups/${group.id}`)}
                      className="min-w-0 break-words font-bold text-graphite-950 text-base leading-tight text-left hover:text-primary-700 transition-colors"
                    >
                      {group.name}
                    </button>
                    <span className={cn(
                      'text-xs font-semibold px-2 py-0.5 rounded-full shrink-0',
                      group.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    )}>
                      {group.is_active ? 'Активна' : 'Закрыта'}
                    </span>
                  </div>

                  {/* Course */}
                  {courseName && (
                    <div className="min-w-0 flex items-center gap-2 text-sm text-primary-700 font-medium">
                      <BookOpen size={13} className="shrink-0 opacity-70" />
                      <span className="truncate">{courseName}</span>
                      {subject && <Badge variant="info" className="text-[11px]">{SUBJECT_LABELS[subject] || subject}</Badge>}
                      {examType && <Badge variant="default" className="text-[11px]">{EXAM_LABELS[examType] || examType}</Badge>}
                    </div>
                  )}
                </div>

                {/* Info rows */}
                <div className="px-5 pb-3 space-y-2 flex-1">

                  {/* Teacher */}
                  {teacherName && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-xs bg-green-100 text-green-700 font-medium px-2 py-0.5 rounded-full shrink-0">учитель</span>
                      <span className="truncate">{teacherName}</span>
                      {group.teachers?.is_active === false && (
                        <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-md shrink-0">неактивен</span>
                      )}
                    </div>
                  )}
                  {!teacherName && (
                    <div className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg ring-1 ring-amber-100">
                      Учитель не назначен
                    </div>
                  )}

                  {/* Curator */}
                  {curatorName && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-xs bg-yellow-100 text-yellow-700 font-medium px-2 py-0.5 rounded-full shrink-0">куратор</span>
                      <span className="truncate">{curatorName}</span>
                      {group.curators?.is_active === false && (
                        <span className="text-xs text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-md shrink-0">неактивен</span>
                      )}
                    </div>
                  )}

                  {/* Schedule */}
                  {group.schedule_days?.length > 0 && (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <Calendar size={13} className="shrink-0" />
                      <span>{group.schedule_days.join(', ')}{group.schedule_time ? ` · ${group.schedule_time}` : ''}</span>
                    </div>
                  )}

                  {/* Students count + progress */}
                  <div>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <Users size={12} />
                        {group.student_count} / {group.max_students} учеников
                      </span>
                      <span className={cn('font-medium', fill >= 90 ? 'text-red-500' : 'text-gray-400')}>{fill}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={cn('h-2 rounded-full transition-all', fill >= 90 ? 'bg-red-400' : fill >= 70 ? 'bg-gold-400' : 'bg-primary-600')}
                        style={{ width: `${Math.min(fill, 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Student avatars */}
                  {students.length > 0 && (
                    <div className="flex -space-x-2 pt-1">
                      {students.slice(0, 7).map((gs: any, i: number) => {
                        const name = gs.students?.profiles?.full_name || '?'
                        return (
                          <div key={gs.student_id || i} title={name}
                            className="w-7 h-7 bg-primary-100 border-2 border-white rounded-full flex items-center justify-center text-primary-600 text-[11px] font-bold">
                            {name.charAt(0)}
                          </div>
                        )
                      })}
                      {students.length > 7 && (
                        <div className="w-7 h-7 bg-gray-100 border-2 border-white rounded-full flex items-center justify-center text-gray-400 text-[11px] font-bold">
                          +{students.length - 7}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="px-4 pb-4 pt-2 border-t border-gray-100 flex gap-2">
                  <button
                    onClick={() => navigate(`/groups/${group.id}`)}
                    className="min-h-11 flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium text-white bg-primary-950 rounded-lg hover:bg-primary-900 transition-colors"
                  >
                    Открыть<ArrowRight size={13} />
                  </button>
                  {canEditOwn && (
                    <>
                      <button
                        onClick={() => openEdit(group)}
                        className="min-h-11 min-w-11 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-white hover:border-primary-200 transition-colors"
                        title="Настройки"
                      >
                        <Pencil size={13} />
                      </button>
                      {canEditOwn && (
                        <button
                          onClick={() => openEdit(group, 'students')}
                          className="min-h-11 min-w-11 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-primary-700 border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
                          title="Ученики"
                        >
                          <Users size={13} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}

          {/* Карточки «Создать группу» тоже нет — по той же причине. */}
        </div>
        )
      })()}

      <GroupModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={reload}
        group={editTarget}
        initialTab={initialTab}
      />
    </div>
  )
}
