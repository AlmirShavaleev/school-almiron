import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchCourseTopicLocks } from '@/lib/progressUnlock'
import {
  activityGrid, dateWeeks, planWeeks, progressView,
  type ActivityGrid, type ActivityRaw, type CalTopicRow, type CalWeek, type PlanItem, type PlanOverride, type ProgressView,
} from '@/lib/topicCalendar'

/**
 * Главная ученика, этап 2 ЛК (письмо 15.10): «Посещения по дням» и «Календарь
 * тем». Только чтение, база не меняется. Сбой чтения — блок не показывается
 * (главная цела).
 */

/** `student_home_activity(84)` — одна RPC: дни заходов, решённые задачи, серия. */
export function useStudentActivity(enabled: boolean, today: string) {
  const [grid, setGrid] = useState<ActivityGrid | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    supabase.rpc('student_home_activity' as never, { p_days: 84 } as never).then(({ data, error }) => {
      if (!alive || error) return
      setGrid(activityGrid(data as ActivityRaw | null, today))
    })
    return () => { alive = false }
  }, [enabled, today])
  return grid
}

export interface CalendarCourse {
  courseId: string
  groupId: string
  title: string
  /** Пробный период подписки: открыты первые 2 урока раздела. */
  demo: boolean
}

export type CourseCalendar =
  | { kind: 'weeks'; course: CalendarCourse; weeks: CalWeek[] }
  | { kind: 'progress'; course: CalendarCourse; view: ProgressView }

// Узкий тип цепочки: таблиц плана нет в сгенерированных типах (они отстают
// от базы и руками не дописываются — CLAUDE.md).
type Res = { data: unknown[] | null; error: unknown }
type Q = PromiseLike<Res> & { in: (c: string, v: unknown[]) => Q }
type Db = { from: (t: string) => { select: (c: string) => Q } }

async function load(courses: CalendarCourse[], today: string): Promise<CourseCalendar[]> {
  const ids = courses.map(c => c.courseId)
  const db = supabase as unknown as Db
  const [locks, plans, items, overrides, topics] = await Promise.all([
    Promise.all(courses.map(c => fetchCourseTopicLocks(c.courseId))),
    db.from('course_study_plans').select('course_id, start_date').in('course_id', ids),
    db.from('course_study_plan_items').select('course_id, topic_id, week_no').in('course_id', ids),
    // Личные сдвиги: RLS отдаёт ученику только его строки.
    db.from('course_study_plan_overrides').select('course_id, topic_id, week_no, removed').in('course_id', ids),
    db.from('topics').select('id, title, is_open, available_from, order_index, module:modules!inner(course_id, order_index)').in('module.course_id', ids),
  ])
  type TopicDb = { id: string; title: string | null; is_open: boolean | null; available_from: string | null; order_index: number | null; module: { course_id: string; order_index: number | null } | null }
  const topicsByCourse = new Map<string, CalTopicRow[]>()
  for (const t of (topics.error ? [] : topics.data ?? []) as TopicDb[]) {
    if (!t.module) continue
    const row: CalTopicRow = {
      id: t.id, title: t.title ?? 'Тема', is_open: t.is_open, available_from: t.available_from,
      order: (t.module.order_index ?? 0) * 10_000 + (t.order_index ?? 0),
    }
    topicsByCourse.set(t.module.course_id, [...(topicsByCourse.get(t.module.course_id) ?? []), row])
  }
  const startOf = new Map(((plans.error ? [] : plans.data ?? []) as Array<{ course_id: string; start_date: string }>).map(p => [p.course_id, p.start_date]))
  const itemsOf = (id: string) => ((items.error ? [] : items.data ?? []) as Array<PlanItem & { course_id: string }>).filter(i => i.course_id === id)
  const overridesOf = (id: string) => ((overrides.error ? [] : overrides.data ?? []) as Array<PlanOverride & { course_id: string }>).filter(o => o.course_id === id)

  const out: CourseCalendar[] = []
  courses.forEach((course, i) => {
    const l = locks[i]
    if (l?.mode === 'progress') {
      if (l.topics.length > 0) out.push({ kind: 'progress', course, view: progressView(l, course.demo, today) })
      return
    }
    const list = topicsByCourse.get(course.courseId) ?? []
    const start = startOf.get(course.courseId)
    const weeks = start
      ? planWeeks(start, itemsOf(course.courseId), overridesOf(course.courseId), list, today)
      : dateWeeks(list, today)
    if (weeks.length > 0) out.push({ kind: 'weeks', course, weeks })
  })
  return out
}

export function useTopicCalendar(courses: CalendarCourse[], today: string) {
  const key = JSON.stringify(courses.map(c => [c.courseId, c.groupId, c.demo]))
  const [got, setGot] = useState<{ key: string; data: CourseCalendar[] } | null>(null)
  useEffect(() => {
    if (courses.length === 0) return
    let alive = true
    load(courses, today)
      .then(data => { if (alive) setGot({ key, data }) })
      .catch(() => { if (alive) setGot({ key, data: [] }) })
    return () => { alive = false }
    // courses сравниваются по key — массив пересоздаётся на каждый рендер
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, today])
  return got && got.key === key ? got.data : null
}
