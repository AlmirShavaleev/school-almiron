import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Живые числа школы для дашборда админа.
 *
 * Всё считает одна definer-RPC `admin_school_stats` и отдаёт ЧИСЛА, а не
 * таблицы: раздавать клиенту права на students/courses/topic_homework_* ради
 * `count` не нужно. Проверка роли — в теле функции, отказ приходит явной
 * ошибкой `ONLY_ADMIN_SEES_SCHOOL_STATS`, а не пустым результатом (урок §47:
 * проглоченный 42501 выглядит как «нет данных»).
 */
export interface SchoolStats {
  teachers:                 number
  students:                 number
  courses:                  number
  homework_submitted_total: number
  homework_submitted_7d:    number
  homework_submitted_today: number
  homework_reviewed:        number
  homework_pending:         number
  /**
   * Возраст самой старой непроверенной работы в днях. `null` — очередь пуста;
   * это не то же самое, что «ждёт ноль дней» (сдали сегодня), и склеивать эти
   * два состояния нельзя. Считает та же RPC, что и `homework_pending`: два
   * числа об одной очереди обязаны приходить из одного места.
   */
  homework_oldest_pending_days: number | null
  variants_completed:       number
  telegram_connected:       number
  visits_today:             number
  visits_7d:                number
  /**
   * §169. Обращения «Сообщить о проблеме» со статусом `new` — те, которых
   * ещё никто не открывал. «В работе» сюда не входит: его уже кто-то видел.
   */
  support_new:              number
  /**
   * §169. Воронка привязки Telegram за 7 суток: сколько ссылок создано и
   * сколько привязок состоялось. Два числа об одном процессе — из одной RPC,
   * как пара `homework_pending` / `homework_oldest_pending_days`. Второе —
   * «людей, привязавшихся за неделю» (строка `telegram_connections` одна на
   * профиль), поэтому оно может быть чуть меньше первого и при здоровой
   * привязке; порог тревоги это учитывает (`telegramLinkingBroken`).
   */
  telegram_links_created_7d:   number
  telegram_links_connected_7d: number
}

const EMPTY: SchoolStats = {
  teachers: 0, students: 0, courses: 0,
  homework_submitted_total: 0, homework_submitted_7d: 0, homework_submitted_today: 0,
  homework_reviewed: 0, homework_pending: 0, homework_oldest_pending_days: null,
  variants_completed: 0, telegram_connected: 0,
  visits_today: 0, visits_7d: 0,
  support_new: 0, telegram_links_created_7d: 0, telegram_links_connected_7d: 0,
}

/**
 * Порог, при котором воронка привязки читается как поломка, а не как шум:
 * ссылок создано хотя бы 5 (меньше — единичные случаи, по ним судить нельзя)
 * и привязалось меньше половины. Вынесено из компонента, чтобы порог был
 * одним числом в одном месте и проверялся напрямую.
 */
export const TELEGRAM_FUNNEL_MIN_LINKS = 5
export function telegramLinkingBroken(created: number, connected: number): boolean {
  return created >= TELEGRAM_FUNNEL_MIN_LINKS && connected / created < 0.5
}

export function useSchoolStats() {
  const [stats,   setStats]   = useState<SchoolStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  // Момент ответа. Нужен, чтобы каждый блок дашборда мог подписаться временем:
  // рядом живут числа из Vercel и Bunny, у которых свои кэши и своя свежесть,
  // и «на когда» у них разное.
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [tick,    setTick]    = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(supabase as any).rpc('admin_school_stats').then(
      ({ data, error: rpcError }: { data: unknown; error: { message?: string } | null }) => {
        if (cancelled) return
        if (rpcError) {
          // Показываем причину словами, а не пустые нули: молчащий дашборд —
          // это тот же класс отказа, что §47.
          setError(
            String(rpcError.message ?? '').includes('ONLY_ADMIN_SEES_SCHOOL_STATS')
              ? 'Статистику школы видит только администратор'
              : rpcError.message || 'Не удалось загрузить статистику школы'
          )
          setStats(null)
        } else {
          setStats({ ...EMPTY, ...(data as Partial<SchoolStats> | null) })
          setFetchedAt(new Date().toISOString())
        }
        setLoading(false)
      },
      (err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось загрузить статистику школы')
        setStats(null)
        setLoading(false)
      },
    )

    return () => { cancelled = true }
  }, [tick])

  return { stats, loading, error, fetchedAt, reload }
}
