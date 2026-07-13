import { deleteMyVariant, useStudentVariantAssignments, type StudentVariantAssignment } from '@/hooks/useVariantAssignments'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { BookOpen, Clock, Calendar, CheckCircle2, Loader2, AlertCircle, Lock, ArrowRight, Hammer, Sparkles, Trash2 } from 'lucide-react'
import { format, isPast, isFuture } from 'date-fns'
import { ru } from 'date-fns/locale'

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS: Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

const STATUS_CONFIG: Record<
  StudentVariantAssignment['status'],
  { label: string; color: string; icon: React.ReactNode }
> = {
  not_started: { label: 'Не начат',     color: 'text-gray-500 bg-gray-100',   icon: <Clock size={13} /> },
  available:   { label: 'Доступен',     color: 'text-blue-700 bg-blue-100',   icon: <BookOpen size={13} /> },
  in_progress: { label: 'В процессе',   color: 'text-yellow-700 bg-yellow-100', icon: <Clock size={13} /> },
  submitted:   { label: 'Сдан',         color: 'text-green-700 bg-green-100', icon: <CheckCircle2 size={13} /> },
  completed:   { label: 'Завершён',     color: 'text-green-700 bg-green-100', icon: <CheckCircle2 size={13} /> },
  overdue:     { label: 'Просрочен',    color: 'text-red-700 bg-red-100',     icon: <AlertCircle size={13} /> },
  cancelled:   { label: 'Отменён',      color: 'text-gray-400 bg-gray-100',   icon: <Lock size={13} /> },
}

function resolveDisplayStatus(a: StudentVariantAssignment): StudentVariantAssignment['status'] {
  if (a.status !== 'not_started') return a.status
  if (a.available_from && isFuture(new Date(a.available_from))) return 'not_started'
  if (a.due_at && isPast(new Date(a.due_at))) return 'overdue'
  return 'available'
}

export function StudentVariantsPage() {
  const { assignments, loading, error, reload } = useStudentVariantAssignments()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete(assignment: StudentVariantAssignment) {
    const confirmed = window.confirm(
      `Удалить вариант "${assignment.variant?.title ?? 'Без названия'}" без возможности восстановления?`,
    )
    if (!confirmed) return

    setDeletingId(assignment.id)
    setDeleteError(null)
    try {
      await deleteMyVariant(assignment.id)
      await reload()
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : 'Не удалось удалить вариант')
    } finally {
      setDeletingId(current => current === assignment.id ? null : current)
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <Loader2 size={28} className="animate-spin text-primary-500 mx-auto" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Тренировочные варианты</h1>
          <p className="text-sm text-gray-500 mt-0.5">Варианты, назначенные учителем</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to="/student/variants/generate"
            data-testid="generate-variant-link"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
          >
            <Sparkles size={15} /> Сгенерировать вариант
          </Link>
          <Link
            to="/student/variants/build"
            data-testid="build-own-variant-link"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors"
          >
            <Hammer size={15} /> Собрать вручную
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
      )}
      {deleteError && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{deleteError}</div>
      )}

      {assignments.length === 0 && !loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <BookOpen size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 text-sm">Учитель ещё не назначил ни одного варианта</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map(a => {
            const displayStatus = resolveDisplayStatus(a)
            const cfg = STATUS_CONFIG[displayStatus] ?? STATUS_CONFIG.not_started
            const isLocked = a.available_from && isFuture(new Date(a.available_from))
            const isOverdue = displayStatus === 'overdue'
            const groupName = a.group_name ?? a.assignment?.group?.name
            const teacherName = a.teacher_name
              ?? a.assignment?.group?.teacher?.profiles?.full_name
              ?? a.assignment?.assigned_by_profile?.full_name

            return (
              <div key={a.id}
                className={`bg-white rounded-xl border p-4 transition-colors ${
                  isLocked || isOverdue
                    ? 'border-gray-200 opacity-75'
                    : 'border-gray-200 hover:border-primary-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 bg-primary-50 text-primary-600 rounded-lg shrink-0">
                      <BookOpen size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-semibold text-gray-900 text-sm">
                          {a.variant?.title ?? 'Вариант'}
                        </h3>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                          {cfg.icon} {cfg.label}
                        </span>
                      </div>

                      {a.variant && (
                        <div className="text-xs text-gray-500 mb-2 space-y-0.5">
                          <p>
                            {SUBJECT_LABELS[a.variant.subject]} · {EXAM_LABELS[a.variant.exam_type]}
                            {' · '}{a.variant.tasks_count} задач
                          </p>
                          {groupName && <p>Группа: {groupName}</p>}
                          {teacherName && <p>Преподаватель: {teacherName}</p>}
                        </div>
                      )}

                      <div className="flex items-center gap-4 flex-wrap">
                        {a.available_from && (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <Clock size={11} />
                            {isLocked ? 'Откроется' : 'Открыт с'} {format(new Date(a.available_from), 'd MMM HH:mm', { locale: ru })}
                          </span>
                        )}
                        {a.due_at && (
                          <span className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                            <Calendar size={11} />
                            Дедлайн {format(new Date(a.due_at), 'd MMM yyyy HH:mm', { locale: ru })}
                          </span>
                        )}
                        {a.max_attempts > 1 && (
                          <span className="text-xs text-gray-400">
                            Попытки: {a.attempts_used}/{a.max_attempts}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2 flex-wrap justify-end">
                    {displayStatus === 'completed' || displayStatus === 'submitted' ? (
                      <CheckCircle2 size={20} className="text-green-500 mt-0.5" />
                    ) : isLocked ? (
                      <button
                        type="button"
                        disabled
                        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-400 disabled:cursor-not-allowed"
                      >
                        <Lock size={13} />
                        Откроется {format(new Date(a.available_from!), 'd MMM HH:mm', { locale: ru })}
                      </button>
                    ) : isOverdue ? (
                      <button
                        type="button"
                        disabled
                        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-400 disabled:cursor-not-allowed"
                      >
                        <AlertCircle size={13} />
                        Просрочен
                      </button>
                    ) : (
                      <Link
                        to={`/student/variants/${a.id}`}
                        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1"
                      >
                        <BookOpen size={13} />
                        Открыть вариант
                        <ArrowRight size={13} />
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDelete(a)}
                      disabled={deletingId === a.id}
                      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingId === a.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      Удалить
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
