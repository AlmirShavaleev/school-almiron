import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Четыре среза активности школы для дашборда (продолжение §78).
 *
 * Все считают definer-RPC, сужение внутри них — через `course_is_staff`, ту же
 * функцию, которой живут все проверки «персонал ли я по этому курсу». Клиент
 * ничего не фильтрует: у админа RLS не сужает ничего, и повторять правило
 * здесь значило бы завести ещё одну копию (§21/§29).
 *
 * Отказ приходит ошибкой `NOT_STAFF_OF_ANY_COURSE`, а не пустым списком —
 * молчащий экран неотличим от «данных нет» (уроки §47 и §54).
 */

export interface DormantStudent {
  student_id:    string
  profile_id:    string
  full_name:     string
  course_titles: string
  last_active:   string | null
  days_silent:   number | null
  never_active:  boolean
}

export interface ActivityDay {
  day:    string
  people: number
}

export interface UnopenedTopic {
  topic_id:     string
  topic_title:  string
  course_title: string
  total_items:  number
  unopened:     number
  has_data:     boolean
}

export interface HomeworkFunnelRow {
  course_id:    string
  course_title: string
  expected:     number
  submitted:    number
  accepted:     number
}

/**
 * Сторож врезки. Клиентский вызов `record_material_view` глушит любую ошибку
 * (учёт не должен мешать открыть файл), поэтому разъехавшийся контракт не
 * скажет о себе НИЧЕГО — аналитика просто перестанет наполняться. Ноль здесь
 * — единственный видимый признак поломки.
 */
export interface ViewHealth {
  views_7d:    number
  views_total: number
  first_day:   string | null
}

export interface SchoolAnalytics {
  dormant:  DormantStudent[]
  activity: ActivityDay[]
  unopened: UnopenedTopic[]
  funnel:   HomeworkFunnelRow[]
  viewHealth: ViewHealth
  /**
   * Ведётся ли уже учёт просмотров. Пока нет — «что не открывают» показывает
   * заглушку: список всех материалов подряд был бы не ответом, а артефактом
   * того, что учёт только заведён.
   */
  hasViewData: boolean
}

const EMPTY: SchoolAnalytics = {
  dormant: [], activity: [], unopened: [], funnel: [],
  viewHealth: { views_7d: 0, views_total: 0, first_day: null },
  hasViewData: false,
}

/** Дата, с которой заведён учёт открытий материалов (§107). */
export const MATERIAL_VIEWS_SINCE = '2026-08-08'

/** Порог молчания в днях. */
export const DORMANT_DAYS = 7

/** Учёт заходов заведён вместе с §78 — раньше этой даты данных нет вовсе. */
export const VISITS_SINCE = '2026-08-04'

export function useSchoolAnalytics() {
  const [data, setData] = useState<SchoolAnalytics>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const db = supabase as any
      const [dormantRes, activityRes, unopenedRes, funnelRes, healthRes] = await Promise.all([
        db.rpc('school_dormant_students', { p_days: DORMANT_DAYS }),
        db.rpc('school_activity_daily', { p_days: 30 }),
        db.rpc('school_unopened_materials', { p_limit: 20 }),
        db.rpc('school_homework_funnel'),
        db.rpc('school_material_view_health'),
      ])
      if (cancelled) return

      const failure = [dormantRes, activityRes, unopenedRes, funnelRes, healthRes].find(r => r?.error)
      if (failure) {
        const message = String(failure.error?.message ?? '')
        setError(message.includes('NOT_STAFF_OF_ANY_COURSE')
          ? 'Статистику видит тот, кто ведёт хотя бы один курс'
          : failure.error?.message || 'Не удалось загрузить статистику')
        setData(EMPTY)
        setLoading(false)
        return
      }

      const unopened = (unopenedRes.data ?? []) as UnopenedTopic[]
      setData({
        dormant:  (dormantRes.data ?? []) as DormantStudent[],
        activity: (activityRes.data ?? []) as ActivityDay[],
        unopened,
        funnel:   (funnelRes.data ?? []) as HomeworkFunnelRow[],
        // RPC возвращает одну строку; при пустом ответе считаем, что записей
        // нет — это и есть тревожный ноль, а не «не смогли посчитать».
        viewHealth: ((healthRes.data ?? [])[0] as ViewHealth | undefined)
          ?? { views_7d: 0, views_total: 0, first_day: null },
        // Флаг приходит из RPC одинаковым во всех строках; при пустом списке
        // данных тем более нет.
        hasViewData: unopened.length > 0 ? Boolean(unopened[0].has_data) : false,
      })
      setLoading(false)
    }

    load().catch(err => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Не удалось загрузить статистику')
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [tick])

  return { ...data, loading, error, reload }
}
