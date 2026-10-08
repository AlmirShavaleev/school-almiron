import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CalendarTopic } from '@/lib/studentCalendar'

/**
 * §274. Темы с датой открытия по всем курсам ученика — для календаря главной.
 *
 * Один запрос на все курсы: `topics` с `modules!inner(course_id)` и фильтром по
 * курсам. Политика `topics_select_all` отдаёт строки тем всем (содержимое
 * закрытых тем закрывают таблицы материалов и ДЗ), поэтому видны и ещё не
 * открытые уроки — ради них календарь и нужен. Берём только темы на
 * автоматике (`is_open is null`): у темы с тумблером дата не действует
 * (§59, `willOpenByDate`).
 *
 * Ошибка не роняет главную: календарь просто рисуется без открытий уроков.
 */

// Вложенный фильтр `module.course_id` типы PostgREST не выводят.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

interface Row {
  id: string
  title: string | null
  available_from: string | null
  is_open: boolean | null
  kind?: string | null
  module: { course_id: string } | { course_id: string }[] | null
}

export function useStudentCalendarTopics(courseIds: string[]): CalendarTopic[] {
  const key = [...new Set(courseIds)].sort().join(',')
  // Ответ помечен ключом запроса: смена курсов — пусто, пока не придёт свой.
  const [state, setState] = useState<{ key: string; topics: CalendarTopic[] }>({ key: '', topics: [] })

  useEffect(() => {
    if (!key) return
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await db
          .from('topics')
          // `*` не нужен: kind есть с §240, на проде применён.
          .select('id, title, available_from, is_open, kind, module:modules!inner(course_id)')
          .in('module.course_id', key.split(','))
          .not('available_from', 'is', null)
          .is('is_open', null)
          .limit(1000)
        if (error) throw new Error(error.message ?? 'Не удалось загрузить даты уроков')
        if (cancelled) return
        const rows: CalendarTopic[] = []
        for (const r of (data ?? []) as Row[]) {
          const mod = Array.isArray(r.module) ? r.module[0] : r.module
          if (!mod?.course_id) continue
          rows.push({
            id: r.id, title: r.title ?? 'Урок', available_from: r.available_from,
            is_open: r.is_open ?? null, kind: r.kind ?? null, course_id: mod.course_id,
          })
        }
        setState({ key, topics: rows })
      } catch (e) {
        if (!cancelled) console.warn('Календарь: не удалось загрузить даты открытия уроков', e)
      }
    })()
    return () => { cancelled = true }
  }, [key])

  return state.key === key && key ? state.topics : EMPTY
}

const EMPTY: CalendarTopic[] = []
