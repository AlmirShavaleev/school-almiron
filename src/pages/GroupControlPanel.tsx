import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, BookOpen, Loader2, AlertCircle, Calendar, Clock, Layers } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { cn } from '@/utils/cn'
import { useGroupControl, type GroupStudent } from '@/hooks/useGroupControl'
import { GroupHeaderActions } from '@/components/group/GroupHeaderActions'
import { GroupKPI } from '@/components/group/GroupKPI'
import { HomeworkPipeline } from '@/components/group/HomeworkPipeline'
import { LessonStream } from '@/components/group/LessonStream'
import { StudentManager } from '@/components/group/StudentManager'
import { TransferStudentModal } from '@/components/group/TransferStudentModal'
import { GroupModal } from '@/components/modals/GroupModal'
import { CreateLessonModal } from '@/components/modals/CreateLessonModal'
import { CreateHomeworkModal } from '@/components/modals/CreateHomeworkModal'

export function GroupControlPanel() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const role = useAuthStore(s => s.profile?.role)
  const canManage = role === 'admin' || role === 'owner'
  const canTeach  = canManage || role === 'teacher'

  const { group, students, lessons, pipeline, kpi, loading, error, reload } = useGroupControl(id)

  const [editOpen, setEditOpen]       = useState(false)
  const [studentsOpen, setStudentsOpen] = useState(false)
  const [lessonOpen, setLessonOpen]   = useState(false)
  const [hwOpen, setHwOpen]           = useState(false)
  const [transfer, setTransfer]       = useState<GroupStudent | null>(null)

  async function archiveToggle() {
    if (!group) return
    await supabase.from('groups').update({ is_active: !group.is_active } as any).eq('id', group.id)
    reload()
  }
  async function remove() {
    if (!group) return
    if (!confirm(`Удалить группу «${group.name}»? Ученики и занятия группы будут отвязаны. Действие необратимо.`)) return
    const { error: e } = await supabase.from('groups').delete().eq('id', group.id)
    if (e) { alert(e.message); return }
    navigate('/groups')
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <Loader2 size={28} className="animate-spin text-primary-600" />
      <span className="text-gray-500 text-sm">Загружаем панель группы…</span>
    </div>
  )
  if (!group) return (
    <div className="max-w-md mx-auto mt-16 text-center space-y-4">
      <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto">
        <AlertCircle size={28} className="text-gray-400" />
      </div>
      <h2 className="text-xl font-bold text-gray-800">Группа не найдена</h2>
      <p className="text-gray-500 text-sm">Возможно, она была удалена или перемещена.</p>
      <button
        onClick={() => navigate('/groups')}
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors"
      >
        <ArrowLeft size={15} />Вернуться к списку групп
      </button>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* back */}
      <button onClick={() => navigate('/groups')} className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
        <ArrowLeft size={15} />К группам
      </button>

      {/* Operational header */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900 truncate">{group.name}</h1>
              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',
                group.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500')}>
                {group.is_active ? 'Активна' : 'Архив'}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-sm text-gray-500 flex-wrap">
              {group.course && (
                <Link to="/course-program" className="inline-flex items-center gap-1 hover:text-primary-600">
                  <BookOpen size={13} />{group.course.title}
                </Link>
              )}
              <span className="inline-flex items-center gap-1"><Layers size={13} />{students.length}/{group.max_students}</span>
              {(group.schedule_days?.length || group.schedule_time) && (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={13} />{group.schedule_days?.join(', ') || '—'}
                  {group.schedule_time && <><Clock size={12} className="ml-1" />{group.schedule_time}</>}
                </span>
              )}
              <span className="text-gray-400">учитель: {group.teacher_name || '—'} · куратор: {group.curator_name || '—'}</span>
            </div>
          </div>
          <GroupHeaderActions
            group={group} canManage={canManage} canTeach={canTeach}
            onEdit={() => setEditOpen(true)}
            onAddLesson={() => setLessonOpen(true)}
            onAddHomework={() => setHwOpen(true)}
            onArchiveToggle={archiveToggle}
            onDelete={remove}
          />
        </div>
      </div>

      {/* KPI */}
      <GroupKPI kpi={kpi} />

      {/* Homework pipeline — ядро */}
      <div>
        <h2 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-1.5"><Layers size={15} />Поток домашних заданий</h2>
        <HomeworkPipeline pipeline={pipeline} groupId={group.id} />
      </div>

      {/* Lessons + Students */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LessonStream lessons={lessons} canManage={canTeach} onCreate={() => setLessonOpen(true)} />
        <StudentManager
          students={students} groupId={group.id} max={group.max_students}
          canManage={canManage}
          onAdd={() => setStudentsOpen(true)}
          onTransfer={s => setTransfer(s)}
          onChanged={reload}
        />
      </div>

      {/* Modals */}
      <GroupModal
        open={editOpen} onClose={() => setEditOpen(false)} onSaved={reload}
        initialTab="settings"
        group={{
          id: group.id, name: group.name, course_id: group.course_id,
          teacher_id: group.teacher_id, curator_id: group.curator_id,
          max_students: group.max_students, schedule_days: group.schedule_days || [],
          schedule_time: group.schedule_time, is_active: group.is_active,
        }}
      />
      <GroupModal
        open={studentsOpen} onClose={() => setStudentsOpen(false)} onSaved={reload}
        initialTab="students"
        group={{
          id: group.id, name: group.name, course_id: group.course_id,
          teacher_id: group.teacher_id, curator_id: group.curator_id,
          max_students: group.max_students, schedule_days: group.schedule_days || [],
          schedule_time: group.schedule_time, is_active: group.is_active,
        }}
      />
      <CreateLessonModal
        open={lessonOpen} onClose={() => setLessonOpen(false)} onCreated={reload}
        defaultGroupId={group.id}
        defaultTeacherId={group.teacher_id ?? undefined}
      />
      <CreateHomeworkModal open={hwOpen} onClose={() => setHwOpen(false)} onCreated={reload} defaultGroupId={group.id} />
      {transfer && (
        <TransferStudentModal
          open={!!transfer} onClose={() => setTransfer(null)} onDone={reload}
          studentId={transfer.id} studentName={transfer.full_name} fromGroupId={group.id}
        />
      )}
    </div>
  )
}
