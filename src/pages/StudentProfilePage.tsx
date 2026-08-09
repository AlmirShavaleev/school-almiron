import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Users, Star,
  Mail, Phone, Loader2, ChevronDown, ChevronUp, CreditCard, RefreshCw, AlertCircle,
} from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { useStudentProfile } from '@/hooks/useStudentProfile'
import { useStudentNumberStats } from '@/hooks/useStudentNumberStats'
import { useStudentCourseMemberships } from '@/hooks/useStudentCourseMemberships'
import { useGroups } from '@/hooks/useGroups'
import { StudentNumberStatsSection } from '@/components/student/StudentNumberStatsSection'
import { StudentInsightSection } from '@/components/student/StudentInsightSection'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { DistributeJoinRequestWizard, type DistributeGroupOption } from '@/components/students/DistributeJoinRequestWizard'
import { Plus, BookOpen, Calendar } from 'lucide-react'

// Кольцо посещаемости, бейдж статуса легаси-ДЗ и значок посещения удалены
// вместе со своими блоками (см. комментарий у секции анализа ниже): все три
// стояли на таблицах с нулём строк.

// ─── Section toggle ───────────────────────────────────────────────────────────
function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <Card className="p-0 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 font-semibold text-gray-900">
          {title}
          {count !== undefined && (
            <span className="text-xs font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{count}</span>
          )}
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && <div className="border-t border-gray-100">{children}</div>}
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function StudentProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: s, loading } = useStudentProfile(id || null)
  const currentUserRole = useAuthStore(state => state.profile?.role)
  const [groupsExpanded, setGroupsExpanded] = useState(false)
  const numberStats = useStudentNumberStats(
    s?.student_id ?? null,
    s?.target_subject ?? null,
    s?.target_exam ?? null,
  )

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400 gap-2">
      <Loader2 size={20} className="animate-spin" />Загрузка…
    </div>
  )

  if (!s) return (
    <div className="text-center py-20 text-gray-400">
      <Users size={40} className="mx-auto mb-3 opacity-30" />
      <p>Студент не найден</p>
    </div>
  )

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Back */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft size={16} />Назад
        </button>
        {s.student_id && (
          <button
            onClick={() => navigate(`/students/${s.student_id}/journal`)}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            Журнал ученика
          </button>
        )}
      </div>

      {/* Profile header */}
      <Card className="overflow-hidden relative">
        <div className="absolute inset-y-0 right-0 w-64 bg-gradient-to-l from-primary-50/80 to-transparent pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row lg:items-center gap-5">
          {/* Avatar */}
          <div className="w-20 h-20 rounded-lg bg-primary-950 flex items-center justify-center text-white font-bold text-2xl shrink-0 overflow-hidden shadow-lg shadow-primary-950/15">
            {s.avatar_url
              ? <img src={s.avatar_url} className="w-full h-full object-cover" />
              : s.full_name.charAt(0)
            }
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight text-graphite-950">{s.full_name}</h1>
              {s.target_score && (
                <span className="flex items-center gap-1 rounded-full bg-gold-50 px-2.5 py-1 text-xs font-semibold text-gold-800 ring-1 ring-gold-100">
                  <Star size={12} />Цель: {s.target_score}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-500">
              <span className="flex items-center gap-1.5"><Mail size={13} />{s.email}</span>
              {s.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{s.phone}</span>}
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {s.groups.length <= 1 ? (
                s.groups.map(g => (
                  <span key={g.id} className="flex items-center gap-1.5 text-xs bg-primary-50 text-primary-700 border border-primary-200 px-2.5 py-1 rounded-full">
                    <Users size={11} />{g.name}
                    <span className="text-primary-400">· {g.course_title}</span>
                  </span>
                ))
              ) : (
                <>
                  <button
                    onClick={() => setGroupsExpanded(v => !v)}
                    className="flex items-center gap-1.5 text-xs bg-primary-50 text-primary-700 border border-primary-200 px-2.5 py-1 rounded-full hover:bg-primary-100"
                  >
                    <Users size={11} />
                    {new Set(s.groups.map(g => g.course_title)).size} курс{new Set(s.groups.map(g => g.course_title)).size === 1 ? '' : 'а'} · {s.groups.length} групп{s.groups.length === 1 ? 'а' : 'ы'}
                    {groupsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {groupsExpanded && s.groups.map(g => (
                    <span key={g.id} className="flex items-center gap-1.5 text-xs bg-slate-50 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-full">
                      <Users size={11} />{g.name}
                      <span className="text-slate-400">· {g.course_title}</span>
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/*
        Плитки посещаемости, ДЗ и пробников сняты 2026-08-09 (решение
        оркестратора к §106): они стояли на мёртвых таблицах — `attendance` 0
        строк (продукт отказался от посещаемости), `homework_submissions` 0
        (легаси-контур ДЗ, весь трафик в `topic_homework_*`),
        `mock_exam_results` 0 (страницы пробников скрыты). Нули там читались как
        факт «ученик ничего не сдал», хотя данных не было вовсе. Работу
        честно делает секция ниже — на живом контуре.
      */}
      {s.student_id && <StudentInsightSection studentId={s.student_id} />}

      {/* Enrolled courses */}
      {s.student_id && (
        <EnrolledCoursesSection studentId={s.student_id} studentFullName={s.full_name} currentRole={currentUserRole} />
      )}

      {s.student_id && s.target_subject && s.target_exam && (
        <StudentNumberStatsSection
          rows={numberStats.rows}
          loading={numberStats.loading}
          error={numberStats.error}
        />
      )}

    </div>
  )
}

// ── Enrolled courses section ───────────────────────────────────────────────
// Source of truth: group_students -> groups -> courses (real access). Deliberately not
// student_courses -- that table is legacy and disconnected from actual course access, which
// is exactly the bug this section fixes (header badge showed real groups, this block showed
// "not enrolled" from an unrelated table).
function EnrolledCoursesSection({ studentId, studentFullName, currentRole }: { studentId: string; studentFullName: string; currentRole: string | undefined }) {
  const { courses, loading, reload } = useStudentCourseMemberships(studentId)
  const { groups: teacherGroups } = useGroups()
  const [wizardOpen, setWizardOpen] = useState(false)
  const canManage = currentRole === 'admin' || currentRole === 'owner' || currentRole === 'curator' || currentRole === 'teacher'

  const GROUP_TYPE_LABELS: Record<string, string> = {
    individual: 'Индивидуально',
    pair: 'Пара',
    group: 'Мини-группа',
  }

  const distributeGroups: DistributeGroupOption[] = useMemo(
    () => teacherGroups.map((group: any) => ({
      id: group.id,
      name: group.name,
      courseId: group.course_id ?? null,
      isActive: Boolean(group.is_active),
      maxStudents: group.max_students ?? 0,
      studentCount: group.student_count ?? 0,
      memberStudentIds: (group.group_students ?? []).map((gs: any) => gs.student_id),
      scheduleDays: group.schedule_days ?? null,
      scheduleTime: group.schedule_time ?? null,
    })),
    [teacherGroups],
  )

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-primary-600" />
          <h3 className="text-sm font-semibold text-gray-900">Курсы ученика</h3>
          {courses.length > 0 && (
            <span className="text-xs text-gray-400">({courses.length})</span>
          )}
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Plus size={13} className="mr-1" />Распределить
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-gray-400 text-sm">
          <Loader2 size={16} className="animate-spin" />Загрузка…
        </div>
      ) : courses.length === 0 ? (
        <div className="flex flex-col items-center py-10 gap-2 text-center">
          <BookOpen size={32} className="text-gray-200" />
          <p className="text-sm text-gray-400">Ученик не записан ни на один курс</p>
          {canManage && (
            <button onClick={() => setWizardOpen(true)} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
              Распределить на курс
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-gray-50">
          {courses.map(c => (
            <div key={c.courseId} className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50">
              <div className="w-9 h-9 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                <BookOpen size={15} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-gray-900 truncate">{c.courseTitle}</span>
                <div className="text-xs text-gray-500 mt-0.5">
                  {c.courseSubject === 'physics' ? 'Физика' : c.courseSubject === 'math' ? 'Математика' : c.courseSubject}
                  {c.courseExamType && ` · ${c.courseExamType.toUpperCase()}`}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.groups.map(g => (
                    <span key={g.groupId} className="inline-flex items-center gap-1 text-xs bg-primary-50 text-primary-700 border border-primary-100 px-2 py-0.5 rounded-full">
                      {g.groupName}
                      <span className="text-primary-400">· {GROUP_TYPE_LABELS[g.groupType] || g.groupType}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {wizardOpen && (
        <DistributeJoinRequestWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          studentId={studentId}
          studentFullName={studentFullName}
          groups={distributeGroups}
          onDistributed={reload}
        />
      )}
    </Card>
  )
}
