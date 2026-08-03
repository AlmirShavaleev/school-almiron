import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, AlertCircle, ChevronRight, CheckCircle2, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { supabase } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/**
 * Тестирования темы, выданные этому ученику.
 *
 * Открытие ведёт на `/student/variants/:studentAssignmentId` — тот же экран,
 * что и из списка своих тестирований. Второго пути прохождения нет намеренно:
 * иначе появились бы две ветки старта попытки, расходящиеся в поведении.
 *
 * Что видно, решает RPC: закрытую тему закрывает `course_student_can_see_topic`,
 * а невыданное тестирование сюда не приходит вовсе.
 */

export interface StudentTopicVariant {
  student_assignment_id: string
  variant_id: string
  title: string
  subject: string
  exam_type: string
  tasks_count: number
  status: string
  due_at: string | null
  score: number | null
  max_score: number | null
  percentage: number | null
  grading_status: string | null
}

const SUBJECT_LABELS: Record<string, string> = { math: 'Математика', physics: 'Физика' }
const EXAM_LABELS:    Record<string, string> = { ege: 'ЕГЭ', oge: 'ОГЭ' }

export function useTopicStudentVariants(topicId: string | undefined) {
  const [variants, setVariants] = useState<StudentTopicVariant[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!topicId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    const { data, error: err } = await db.rpc('topic_student_variants', { p_topic_id: topicId })
    if (err) setError(err.message)
    setVariants(data ?? [])
    setLoading(false)
  }, [topicId])

  useEffect(() => { void load() }, [load])

  return { variants, loading, error, reload: load }
}

export function TopicVariantStudent({ topicId }: { topicId: string }) {
  const { variants, loading, error } = useTopicStudentVariants(topicId)

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Загрузка тестирований…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
        <AlertCircle size={14} className="shrink-0 mt-0.5" />
        <span>{error}</span>
      </div>
    )
  }

  if (variants.length === 0) return null

  return (
    <div className="space-y-2">
      {variants.map(v => (
        <Link
          key={v.student_assignment_id}
          to={`/student/variants/${v.student_assignment_id}`}
          className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 hover:border-primary-300 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 truncate">{v.title}</div>
            <div className="mt-0.5 text-xs text-gray-500 flex items-center gap-3 flex-wrap">
              <span>
                {SUBJECT_LABELS[v.subject] ?? v.subject} · {EXAM_LABELS[v.exam_type] ?? v.exam_type} · {v.tasks_count} задач
              </span>
              {v.due_at && (
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  до {format(new Date(v.due_at), 'd MMMM', { locale: ru })}
                </span>
              )}
            </div>
            <div className="mt-1">
              <StatusLine variant={v} />
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-300 shrink-0" />
        </Link>
      ))}
    </div>
  )
}

function StatusLine({ variant }: { variant: StudentTopicVariant }) {
  const done = variant.status === 'submitted' || variant.status === 'completed'

  if (done) {
    // После сдачи с темы видно то же, что в списке: балл и процент.
    const hasScore = variant.score !== null && variant.max_score !== null
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 size={12} />
        {hasScore
          ? `Сдано · ${variant.score} из ${variant.max_score}${
              variant.percentage !== null ? ` (${Math.round(variant.percentage)}%)` : ''
            }`
          : 'Сдано · ждёт проверки'}
      </span>
    )
  }

  if (variant.status === 'in_progress') {
    return <span className="text-xs font-medium text-amber-700">Начато — можно продолжить</span>
  }

  return <span className="text-xs font-medium text-primary-700">Пройти тестирование →</span>
}
