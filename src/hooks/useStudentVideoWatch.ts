import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { summarizeWatchDays, type WatchSummary } from '@/lib/videoWatch'

/**
 * Сколько ученик смотрел видео — для карточки у преподавателя (§204).
 *
 * Ключ здесь `profiles.id`, а не `students.id`: `video_watch_daily.student_id`
 * заполняется из `auth.uid()`. Карточка ученика оперирует `students.id`, и это
 * ровно то место, где легко подставить не тот идентификатор и получить вечный
 * ноль — поэтому имя параметра `profileId`, а не `studentId`.
 *
 * Сужение — целиком RLS (`video_watch_daily_staff_select`): персонал видит
 * строки по материалам своих тем. Своего условия прав клиент не повторяет.
 *
 * `supabase as any` — таблица заведена миграцией §204, генерируемые типы
 * отстают (CLAUDE.md).
 */

const db = () => supabase as any

export interface StudentVideoWatch extends WatchSummary {
  loading: boolean
  /** База ответила отказом или таблицы ещё нет — цифру не показываем вовсе. */
  unavailable: boolean
}

const EMPTY: StudentVideoWatch = {
  totalSeconds: 0, weekSeconds: 0, firstDay: null, loading: false, unavailable: false,
}

export function useStudentVideoWatch(profileId: string | null): StudentVideoWatch {
  const [state, setState] = useState<StudentVideoWatch>({ ...EMPTY, loading: true })

  useEffect(() => {
    if (!profileId) { setState(EMPTY); return }

    let cancelled = false
    setState({ ...EMPTY, loading: true })

    void (async () => {
      const { data, error } = await db()
        .from('video_watch_daily')
        .select('day, seconds')
        .eq('student_id', profileId)

      if (cancelled) return
      if (error) { setState({ ...EMPTY, unavailable: true }); return }

      const today = moscowToday()
      const summary = summarizeWatchDays((data ?? []) as Array<{ day: string; seconds: number | null }>, today)
      setState({ ...summary, loading: false, unavailable: false })
    })()

    return () => { cancelled = true }
  }, [profileId])

  return state
}

/**
 * Сегодня по Москве — тем же счётом, что день в базе. Иначе у ученика из
 * другого часового пояса «за неделю» сдвигалось бы на сутки.
 */
function moscowToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
