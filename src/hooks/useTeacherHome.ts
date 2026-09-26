import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { QUEUE_SELECT, buildQueueWorks, sortQueue, toQueueRows, type QueueRow } from '@/lib/homeworkQueue'
import { EMPTY_HOME, mskToday, normalizeHome, type TeacherHomeData } from '@/lib/teacherHome'
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'

/**
 * §233. Данные главной преподавателя.
 *
 * Два источника, и это намеренно:
 *   * работы ДЗ на проверке — те же строки, что у очереди проверки
 *     (`QUEUE_SELECT` → `toQueueRows` → `buildQueueWorks`), с тем же сужением
 *     владельца в режиме учителя (`useMyTeachingScope`) и без собственных
 *     сдач куратора. Грузим только `submitted`: у работы не бывает двух
 *     активных попыток (индекс `topic_homework_attempts_one_active`), так что
 *     это ровно вкладка «Ждут проверки» очереди — «39 работ» здесь и там
 *     совпадают;
 *   * остальное — `teacher_home` (definer, только свои курсы).
 */

type Res<T> = { data: T | null; error: { message?: string; code?: string } | null }
interface RpcLike { rpc<T = unknown>(fn: string, args: Record<string, unknown>): PromiseLike<Res<T>> }
const db = supabase as unknown as RpcLike

export interface RemindResult {
  sent: number
  pairs: number
  already: number
  no_telegram: { student_id: string; name: string }[]
  muted: { student_id: string; name: string }[]
  sent_at: string
}

export function useTeacherHome() {
  const scope = useMyTeachingScope()
  const [pending, setPending] = useState<QueueRow[]>([])
  const [home, setHome] = useState<TeacherHomeData>(EMPTY_HOME)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  const courseKey = scope.active ? scope.courseIds.join(',') : '*'

  useEffect(() => {
    // Пока «свои курсы» не приехали, фильтровать нечем — иначе на кадр
    // показали бы школу целиком.
    if (scope.active && scope.loading) return
    let cancelled = false
    setError(null)

    const courseIds = scope.active ? scope.courseIds : null
    async function load() {
      const [queueRes, homeRes] = await Promise.all([
        supabase.from('topic_homework_attempts').select(QUEUE_SELECT).eq('status', 'submitted')
          .order('submitted_at', { ascending: true }),
        db.rpc<unknown>('teacher_home', { p_course_ids: courseIds }),
      ])
      if (cancelled) return
      const works = sortQueue(buildQueueWorks(toQueueRows(queueRes.data ?? [])))
      setPending(scope.active
        ? works.filter(r => scope.courseIds.includes(r.courseId) && r.attempt.student_id !== scope.ownStudentId)
        : works)
      setHome(normalizeHome(homeRes.data, mskToday()))
      const err = queueRes.error?.message ?? homeRes.error?.message ?? null
      setError(err)
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
    // courseKey — строковый слепок scope.courseIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, scope.active, scope.loading, courseKey, scope.ownStudentId])

  /**
   * «Напомнить всем»: должников база берёт заново сама (только свои курсы, не
   * чаще раза в сутки на пару «ДЗ + ученик»); `studentIds` — те, кого видно на
   * экране, чтобы не написать тому, кто появился уже после загрузки.
   */
  const remind = useCallback(async (studentIds: string[]): Promise<RemindResult> => {
    const { data, error: err } = await db.rpc<RemindResult>('remind_overdue_homework', {
      p_course_ids: scope.active ? scope.courseIds : null,
      p_student_ids: studentIds,
    })
    if (err) throw new Error(err.message || 'Не удалось отправить напоминания')
    reload()
    return data ?? { sent: 0, pairs: 0, already: 0, no_telegram: [], muted: [], sent_at: new Date().toISOString() }
  }, [scope.active, scope.courseIds, reload])

  return { pending, home, loading, error, reload, remind }
}
