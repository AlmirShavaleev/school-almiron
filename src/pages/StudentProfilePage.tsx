import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Users,
  Mail, Phone, Loader2, ChevronDown, ChevronUp, CreditCard, RefreshCw, AlertCircle,
} from 'lucide-react'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useStudentProfile } from '@/hooks/useStudentProfile'
import { useStudentNumberStats } from '@/hooks/useStudentNumberStats'
import { useStudentCourseMemberships } from '@/hooks/useStudentCourseMemberships'
import { useGroups } from '@/hooks/useGroups'
import { StudentNumberStatsSection } from '@/components/student/StudentNumberStatsSection'
import { StudentInsightSection } from '@/components/student/StudentInsightSection'
import { StudentSubjectTargets } from '@/components/student/StudentSubjectTargets'
import { StudentReportTab } from '@/components/report/StudentReportTab'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { DistributeJoinRequestWizard, type DistributeGroupOption } from '@/components/students/DistributeJoinRequestWizard'
import { enrollableGroups } from '@/lib/enrollmentTargets'
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
  const [searchParams] = useSearchParams()
  // board/023 (§171): переход со строки курса — сразу открыть блок этого
  // курса, а не заставлять преподавателя искать его в списке заново.
  const focusCourseId = searchParams.get('course')
  // §217. Вкладка отчёта живёт в адресе (`?tab=report`): преподаватель
  // открывает отчёт по ссылке из переписки и попадает сразу в него, а не на
  // карточку, которую надо переключать руками.
  const tab = searchParams.get('tab') === 'report' ? 'report' : 'card'
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
            {/*
              §217. Плашка «Цель: 80» снята (решение оркестратора 25.09).
              Она читала старое `students.target_score` — ОДНУ цель на
              человека, — а прямо под шапкой теперь стоит блок целей ПО
              ПРЕДМЕТАМ (§216). Два источника одной и той же величины на
              одном экране расходятся при первом же вводе: преподаватель
              правит цель по физике, а плашка продолжает показывать старое
              число из другого поля.

              Само поле `students.target_score` НЕ тронуто: его читают «Мой
              прогресс» и настройки ученика, и снимать его будем отдельной
              работой после переноса данных.
            */}
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight text-graphite-950">{s.full_name}</h1>
            </div>

            <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-500">
              {/* Почта — одно слово без пробелов: на телефоне она либо
                  переносится по буквам, либо распирает карточку (§183). */}
              <span className="flex min-w-0 items-center gap-1.5"><Mail size={13} className="shrink-0" /><span className="break-all">{s.email}</span></span>
              {s.phone && <span className="flex items-center gap-1.5"><Phone size={13} className="shrink-0" />{s.phone}</span>}
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {s.groups.length <= 1 ? (
                s.groups.map(g => (
                  <span key={g.id} className="flex items-center gap-1.5 text-xs bg-primary-50 text-primary-700 border border-primary-200 px-2.5 py-1 rounded-full">
                    <Users size={11} className="shrink-0" />{g.course_title}
                    {/* Имя группы печатаем, только когда оно отличается от
                        названия курса: при «один курс = одна группа» (§61) они
                        совпадают, и плашка дважды повторяла одно и то же. */}
                    {g.name !== g.course_title && (
                      <span className="text-primary-400">· {g.name}</span>
                    )}
                  </span>
                ))
              ) : (
                <>
                  <button
                    onClick={() => setGroupsExpanded(v => !v)}
                    className="flex items-center gap-1.5 text-xs bg-primary-50 text-primary-700 border border-primary-200 px-2.5 py-1 rounded-full hover:bg-primary-100"
                  >
                    <Users size={11} className="shrink-0" />
                    {new Set(s.groups.map(g => g.course_title)).size} курс{new Set(s.groups.map(g => g.course_title)).size === 1 ? '' : 'а'} · {s.groups.length} групп{s.groups.length === 1 ? 'а' : 'ы'}
                    {groupsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {groupsExpanded && s.groups.map(g => (
                    <span key={g.id} className="flex items-center gap-1.5 text-xs bg-slate-50 text-slate-600 border border-slate-200 px-2.5 py-1 rounded-full">
                      <Users size={11} className="shrink-0" />{g.course_title}
                      {g.name !== g.course_title && (
                        <span className="text-slate-400">· {g.name}</span>
                      )}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* §217. Две вкладки: рабочая карточка и отчёт, который распечатывают
          родителю. Одним списком они не уживаются — отчёт занимает два листа
          и имеет свой период. */}
      {s.student_id && (
        <div className="flex gap-1 border-b border-graphite-200" role="tablist" aria-label="Разделы карточки ученика">
          <button
            role="tab"
            aria-selected={tab === 'card'}
            data-testid="student-tab-card"
            onClick={() => navigate(`/students/${id}`, { replace: true })}
            className={cn(
              'px-3 py-2 text-sm font-medium transition-colors',
              tab === 'card'
                ? 'border-b-2 border-primary-600 text-graphite-950'
                : 'text-graphite-500 hover:text-graphite-800',
            )}
          >
            Карточка
          </button>
          <button
            role="tab"
            aria-selected={tab === 'report'}
            data-testid="student-tab-report"
            onClick={() => navigate(`/students/${id}?tab=report`, { replace: true })}
            className={cn(
              'px-3 py-2 text-sm font-medium transition-colors',
              tab === 'report'
                ? 'border-b-2 border-primary-600 text-graphite-950'
                : 'text-graphite-500 hover:text-graphite-800',
            )}
          >
            Отчёт для родителя
          </button>
        </div>
      )}

      {s.student_id && tab === 'report' && <StudentReportTab studentId={s.student_id} />}

      {tab === 'card' && (
      <>
      {/*
        Плитки посещаемости, ДЗ и пробников сняты 2026-08-09 (§111, решение
        оркестратора): они стояли на мёртвых таблицах — `attendance` 0
        строк (продукт отказался от посещаемости), `homework_submissions` 0
        (легаси-контур ДЗ, весь трафик в `topic_homework_*`),
        `mock_exam_results` 0 (страницы пробников скрыты). Нули там читались как
        факт «ученик ничего не сдал», хотя данных не было вовсе. Работу
        честно делает секция ниже — на живом контуре.
      */}
      {/*
        §216. Цель по баллу — по строке на предмет, сразу под карточкой.
        §217: плашка «Цель: 80» из шапки СНЯТА — она показывала старое поле
        students.target_score, и два источника одной величины на одном экране
        расходились. Само поле не тронуто: его читают «Мой прогресс» и
        настройки ученика.
      */}
      {s.student_id && <StudentSubjectTargets studentId={s.student_id} />}

      {s.student_id && <StudentInsightSection studentId={s.student_id} profileId={s.profile_id ?? null} />}

      {/* Enrolled courses */}
      {s.student_id && (
        <EnrolledCoursesSection
          studentId={s.student_id}
          studentFullName={s.full_name}
          currentRole={currentUserRole}
          focusCourseId={focusCourseId}
        />
      )}

      {s.student_id && s.target_subject && s.target_exam && (
        <StudentNumberStatsSection
          rows={numberStats.rows}
          loading={numberStats.loading}
          error={numberStats.error}
        />
      )}
      </>
      )}

    </div>
  )
}

// ── Enrolled courses section ───────────────────────────────────────────────
// Source of truth: group_students -> groups -> courses (real access). Deliberately not
// student_courses -- that table is legacy and disconnected from actual course access, which
// is exactly the bug this section fixes (header badge showed real groups, this block showed
// "not enrolled" from an unrelated table).
function EnrolledCoursesSection({
  studentId,
  studentFullName,
  currentRole,
  focusCourseId = null,
}: {
  studentId: string
  studentFullName: string
  currentRole: string | undefined
  focusCourseId?: string | null
}) {
  const { courses, loading, reload } = useStudentCourseMemberships(studentId)
  const { groups: teacherGroups } = useGroups()
  const [wizardOpen, setWizardOpen] = useState(false)
  const canManage = currentRole === 'admin' || currentRole === 'owner' || currentRole === 'curator' || currentRole === 'teacher'

  // Со строки курса на кабинете ученика приходит `?course=<id>` — сразу
  // подскроллить к этому блоку, а не заставлять искать его среди остальных
  // курсов ученика. Ждём, пока список не загружен: раньше `courseRefs` пуст.
  const courseRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [highlightedCourseId, setHighlightedCourseId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusCourseId || loading) return
    const node = courseRefs.current.get(focusCourseId)
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightedCourseId(focusCourseId)
    const timer = setTimeout(() => setHighlightedCourseId(null), 2000)
    return () => clearTimeout(timer)
  }, [focusCourseId, loading])

  const GROUP_TYPE_LABELS: Record<string, string> = {
    individual: 'Индивидуально',
    pair: 'Пара',
    group: 'Мини-группа',
  }

  // Тот же фильтр, что и на странице учеников: шаблон в списке распределения
  // — это приглашение зачислить в каркас.
  const distributeGroups: DistributeGroupOption[] = useMemo(
    () => enrollableGroups(teacherGroups as any[]).map((group: any) => ({
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
            <div
              key={c.courseId}
              ref={node => {
                if (node) courseRefs.current.set(c.courseId, node)
                else courseRefs.current.delete(c.courseId)
              }}
              data-testid="enrolled-course-row"
              data-course-id={c.courseId}
              className={cn(
                'flex items-start gap-3 px-5 py-3 hover:bg-gray-50 transition-colors',
                highlightedCourseId === c.courseId && 'bg-primary-50 ring-2 ring-inset ring-primary-300',
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                <BookOpen size={15} />
              </div>
              <div className="flex-1 min-w-0">
                {/* Строчный `truncate` многоточия не даёт — overflow к inline
                    не применяется, и длинное название курса просто обрывалось
                    на телефоне по букве (§183). Ряд-флекс возвращает
                    многоточие, плашка архива стоит рядом как прежде. */}
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="font-medium text-gray-900 truncate">{c.courseTitle}</span>
                  {/* Курс снят с ведения, но зачисление осталось — говорим об
                      этом прямо, а не прячем строку (§123). */}
                  {!c.courseActive && (
                    <span
                      data-testid="course-archived-badge"
                      className="shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500"
                    >
                      курс в архиве
                    </span>
                  )}
                </div>
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
