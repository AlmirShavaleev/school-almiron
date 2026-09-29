import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  parseStatsSummary, parseStudentsStats, parseTopicStudents, parseTopicsStats,
  type CourseStatsSummary, type CourseStudentsStats, type CourseTopicsStats, type StatsPeriod, type TopicStudentRow,
} from '@/lib/courseStats'

/**
 * §242. Данные статистики курса — по одной RPC на блок (PENDING_242): сводка,
 * темы, ученики; разбивка темы — по раскрытию строки. Функций нет в
 * сгенерированных типах — отсюда `as never`, как у §241.
 *
 * Ошибка — не падение экрана: до применения миграции (или при сбое) программа
 * рисуется как раньше, решает экран по `status: 'error'`.
 *
 * Ответ помечен ключом запроса: смена периода — «грузится», но прежние числа
 * того же курса остаются на экране до прихода новых (без мигания пустотой).
 */
export type StatsStatus = 'idle' | 'loading' | 'ready' | 'error'

function useStatsRpc<T>(fn: string, args: Record<string, string> | null, parse: (raw: unknown) => T | null, refreshKey = 0) {
  const key = args ? `${fn}:${JSON.stringify(args)}:${refreshKey}` : ''
  // Прежние числа держим только в пределах того же курса и темы: при смене
  // периода — да, при переходе в другой курс — нет (чужие фамилии не мигают).
  const scope = args ? `${fn}:${args.p_course_id ?? ''}:${args.p_topic_id ?? ''}` : ''
  const [state, setState] = useState<{ key: string; scope: string; status: StatsStatus; data: T | null }>({ key: '', scope: '', status: 'idle', data: null })

  useEffect(() => {
    if (!key || !args) return
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.rpc(fn as never, args as never)
        if (cancelled) return
        if (error) throw new Error(error.message)
        const parsed = parse(data)
        setState({ key, scope, status: parsed ? 'ready' : 'error', data: parsed })
      } catch (e) {
        if (cancelled) return
        console.warn(`Не удалось загрузить статистику курса (${fn})`, e)
        setState({ key, scope, status: 'error', data: null })
      }
    })()
    return () => { cancelled = true }
    // args входит в key — отдельной зависимостью не нужен.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!key) return { status: 'idle' as StatsStatus, data: null as T | null }
  if (state.key === key) return { status: state.status, data: state.data }
  return { status: 'loading' as StatsStatus, data: state.scope === scope ? state.data : null }
}

export function useCourseStatsSummary(courseId: string | null, period: StatsPeriod, enabled: boolean, refreshKey = 0) {
  return useStatsRpc<CourseStatsSummary>(
    'course_stats_summary',
    courseId && enabled ? { p_course_id: courseId, p_period: period } : null,
    parseStatsSummary, refreshKey,
  )
}

export function useCourseTopicsStats(courseId: string | null, period: StatsPeriod, enabled: boolean, refreshKey = 0) {
  return useStatsRpc<CourseTopicsStats>(
    'course_stats_topics',
    courseId && enabled ? { p_course_id: courseId, p_period: period } : null,
    parseTopicsStats, refreshKey,
  )
}

export function useCourseStudentsStats(courseId: string | null, period: StatsPeriod, enabled: boolean, refreshKey = 0) {
  return useStatsRpc<CourseStudentsStats>(
    'course_stats_students',
    courseId && enabled ? { p_course_id: courseId, p_period: period } : null,
    parseStudentsStats, refreshKey,
  )
}

export function useTopicStudentsStats(courseId: string | null, topicId: string | null, period: StatsPeriod) {
  return useStatsRpc<TopicStudentRow[]>(
    'course_stats_topic_students',
    courseId && topicId ? { p_course_id: courseId, p_topic_id: topicId, p_period: period } : null,
    parseTopicStudents,
  )
}
