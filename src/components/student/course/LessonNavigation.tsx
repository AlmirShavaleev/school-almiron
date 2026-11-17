import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Lock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { isTopicOpen, type TopicOpenState } from '@/lib/topicAvailability'
import { normalizeTopicKind } from '@/lib/timedWork'
import { withProgressLocks, type CourseTopicLocks } from '@/lib/progressUnlock'

interface Lesson extends TopicOpenState {
  id: string
  title: string
  order_index: number
  kind: string | null
}
interface Module {
  id: string
  order_index: number
  topics: Lesson[]
}
const ordered = <T extends { order_index: number; id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id))

/** Только порядок и доступность уроков: без журнала, материалов и расчёта прогресса. */
export function LessonNavigation({ groupId, courseId, topicId, locks, bypassAvailability = false }: {
  groupId: string
  courseId: string
  topicId: string
  locks: CourseTopicLocks | null
  bypassAvailability?: boolean
}) {
  const [lessons, setLessons] = useState<Lesson[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    setLessons(null)
    setFailed(false)
    async function load() {
      try {
        const { data, error } = await supabase.from('modules')
          .select('id, order_index, topics(id, title, order_index, kind, is_open, available_from)')
          .eq('course_id', courseId)
        if (!alive) return
        if (error) { setFailed(true); return }
        const modules = (data ?? []) as unknown as Module[]
        setLessons(ordered(modules).flatMap(m => ordered(m.topics ?? []))
          .filter(t => normalizeTopicKind(t.kind) === 'lesson'))
      } catch { if (alive) setFailed(true) }
    }
    void load()
    return () => { alive = false }
  }, [courseId])

  const visible = withProgressLocks(lessons ?? [], locks)
  const index = visible.findIndex(t => t.id === topicId)
  const previous = index > 0 ? visible[index - 1] : null
  const next = index >= 0 ? visible[index + 1] ?? null : null
  const button = (lesson: (typeof visible)[number] | null, forward: boolean) => {
    const label = forward ? 'Следующий урок' : 'Предыдущий урок'
    const locked = !!lesson && !bypassAvailability && !isTopicOpen(lesson)
    const content = <>
      {forward ? <ArrowRight size={20} className="shrink-0" /> : <ArrowLeft size={20} className="shrink-0" />}
      <span className="min-w-0">
        <span className="block text-base font-semibold">{label}</span>
        <span className="mt-1 block break-words text-sm font-normal">{lesson?.title ?? (failed || (lessons !== null && index < 0) ? 'Переход недоступен' : lessons === null ? 'Загрузка…' : forward ? 'Это последний урок' : 'Это первый урок')}</span>
      </span>
      {locked && <Lock size={16} className="shrink-0" aria-label="Урок закрыт" />}
    </>
    const className = 'flex min-h-20 min-w-0 items-center gap-3 rounded-2xl border border-gray-200 px-4 py-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600'
    return lesson && !locked
      ? <Link to={`/my-course/${groupId}/topic/${lesson.id}`} aria-label={`${label}: ${lesson.title}`}
          className={`${className} bg-white text-gray-900 shadow-sm hover:border-primary-300 hover:bg-primary-50`}>{content}</Link>
      : <button type="button" disabled className={`${className} bg-gray-50 text-gray-400`}>{content}</button>
  }
  return <nav aria-label="Навигация по урокам" className="grid grid-cols-1 gap-3 border-t border-gray-200 pt-6 sm:grid-cols-2">
    {button(previous, false)}
    {button(next, true)}
  </nav>
}
