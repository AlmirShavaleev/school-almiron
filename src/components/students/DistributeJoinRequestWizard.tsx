import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuthStore } from '@/store/authStore'
import {
  distributeJoinRequest,
  distributeStudentCourses,
  getMyActiveCourses,
  type DistributeJoinRequestResult,
  type DistributionAssignmentInput,
  type DistributionMode,
  type TeacherCourseOption,
} from '@/lib/joinRequestDistribution'

export interface DistributeGroupOption {
  id: string
  name: string
  courseId: string | null
  isActive: boolean
  maxStudents: number
  studentCount: number
  memberStudentIds: string[]
  scheduleDays: string[] | null
  scheduleTime: string | null
}

interface Props {
  open: boolean
  onClose: () => void
  /** Provide when distributing a pending teacher_join_request (Stage 2 onboarding). */
  joinRequestId?: string
  studentId: string
  studentFullName: string
  groups: DistributeGroupOption[]
  onDistributed: () => void
}

interface CourseSelection {
  courseId: string
  mode: DistributionMode
  groupId: string
  title: string
  maxStudents: string
}

function makeRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function DistributeJoinRequestWizard({ open, onClose, joinRequestId, studentId, studentFullName, groups, onDistributed }: Props) {
  const profile = useAuthStore(s => s.profile)

  const [courses, setCourses] = useState<TeacherCourseOption[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [coursesError, setCoursesError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Record<string, CourseSelection>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DistributeJoinRequestResult | null>(null)
  const [requestId, setRequestId] = useState(() => makeRequestId())

  useEffect(() => {
    if (!open) return
    setSelected({})
    setSaving(false)
    setError(null)
    setResult(null)
    setRequestId(makeRequestId())
  }, [open])

  useEffect(() => {
    if (!open || !profile?.id) return
    setCoursesLoading(true)
    setCoursesError(null)
    getMyActiveCourses(profile.id)
      .then(setCourses)
      .catch(err => setCoursesError(err instanceof Error ? err.message : 'Не удалось загрузить курсы'))
      .finally(() => setCoursesLoading(false))
  }, [open, profile?.id])

  const alreadyAssignedCourseIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of groups) {
      if (g.isActive && g.courseId && g.memberStudentIds.includes(studentId)) ids.add(g.courseId)
    }
    return ids
  }, [groups, studentId])

  // §61/§64: один курс = одна группа, она заводится вместе с курсом
  // (`courses_ensure_group_trg`) -- на проде сейчас это верно для всех
  // курсов без исключения. Единственный живой способ оказаться без группы --
  // жёсткое удаление группы из «Архивировать группу» (см. открытый вопрос
  // §150: кнопка называется «архивировать», а строка внутри удаляет).
  // Поэтому здесь нет выбора режима -- есть состояние: группа уже есть
  // (кладём туда) или её нет (новая создастся автоматически, как при
  // рождении курса). Берём ЛЮБУЮ группу курса (не только активную и не
  // только со свободными местами) -- уникальный индекс не делает для них
  // исключения.
  const groupByCourse = useMemo(() => {
    const map = new Map<string, DistributeGroupOption>()
    for (const g of groups) {
      if (g.courseId && !map.has(g.courseId)) map.set(g.courseId, g)
    }
    return map
  }, [groups])

  function toggleCourse(courseId: string, courseTitle: string) {
    setSelected(prev => {
      const next = { ...prev }
      if (next[courseId]) {
        delete next[courseId]
      } else {
        const forced = groupByCourse.get(courseId)
        next[courseId] = forced
          ? { courseId, mode: 'existing_group', groupId: forced.id, title: '', maxStudents: '' }
          : { courseId, mode: 'new_group', groupId: '', title: courseTitle, maxStudents: '30' }
      }
      return next
    })
  }

  const selections = Object.values(selected)
  const canSubmit = selections.length > 0

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const assignments: DistributionAssignmentInput[] = selections.map(s => {
        if (s.mode === 'existing_group') {
          return { courseId: s.courseId, mode: 'existing_group', groupId: s.groupId }
        }
        if (s.mode === 'new_group') {
          return {
            courseId: s.courseId,
            mode: 'new_group',
            title: s.title.trim() || null,
            maxStudents: Number(s.maxStudents) || 8,
          }
        }
        return { courseId: s.courseId, mode: 'individual' }
      })
      const res = joinRequestId
        ? await distributeJoinRequest(joinRequestId, assignments, requestId)
        : await distributeStudentCourses(studentId, assignments, requestId)
      setResult(res)
      onDistributed()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось распределить ученика')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between border-b border-gray-100 px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-bold text-graphite-950">Распределить ученика</h2>
            <p className="mt-1 text-sm text-slate-500">{studentFullName}</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {result ? (
            <div className="space-y-5 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 size={28} />
              </div>
              <h3 className="text-lg font-semibold text-graphite-950">Ученик распределён</h3>
              <div className="space-y-2 text-left">
                {result.assignments.map(a => {
                  const course = courses.find(c => c.id === a.courseId)
                  const group = groups.find(g => g.id === a.groupId)
                  const formatLabel = a.mode === 'individual' ? 'Индивидуально'
                    : a.mode === 'new_group' ? 'Новая мини-группа'
                    : a.mode === 'already_assigned' ? 'Уже был назначен'
                    : 'Существующая группа'
                  return (
                    <div key={a.courseId} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                      <div className="font-medium text-graphite-900">{course?.title ?? 'Курс'}</div>
                      <div className="text-slate-500">{group?.name ?? ''} · {formatLabel}</div>
                    </div>
                  )
                })}
              </div>
              <Link to={`/students/${studentId}`}>
                <Button className="w-full">Открыть ученика</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {coursesLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
                  <Loader2 size={16} className="animate-spin" /> Загружаем курсы…
                </div>
              ) : coursesError ? (
                <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{coursesError}</div>
              ) : courses.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  У вас пока нет активных курсов. Создайте курс, чтобы распределять учеников.
                </div>
              ) : (
                <div className="space-y-3">
                  {courses.map(course => {
                    const isAssigned = alreadyAssignedCourseIds.has(course.id)
                    const sel = selected[course.id]
                    const group = groupByCourse.get(course.id)
                    return (
                      <div key={course.id} className={`rounded-xl border p-3 ${isAssigned ? 'border-slate-100 bg-slate-50' : 'border-slate-200'}`}>
                        <label className="flex items-center gap-2 text-sm font-medium text-graphite-900">
                          <input
                            type="checkbox"
                            checked={Boolean(sel)}
                            disabled={isAssigned}
                            onChange={() => toggleCourse(course.id, course.title)}
                          />
                          {course.title}
                          {isAssigned && <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">Уже назначен</span>}
                        </label>

                        {sel && (
                          <div className="mt-2 pl-6">
                            {group ? (
                              <p className="text-xs text-slate-500">
                                Группа «{group.name}»: {group.studentCount}/{group.maxStudents} — ученик будет добавлен в неё.
                              </p>
                            ) : (
                              <p className="text-xs text-slate-500">У курса нет группы — она будет создана.</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              )}

              <Button className="w-full" disabled={!canSubmit} loading={saving} onClick={handleSubmit}>
                Распределить
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
