import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Отметка «просмотрено» у видео ученика (§204).
 *
 * Читаем только свои строки: границу держит RLS
 * (`video_watch_daily_student_select` — `student_id = auth.uid()`), фильтр по
 * `student_id` стоит здесь не вместо неё, а чтобы у персонала, случайно
 * попавшего на ученический список, не подмешались чужие строки.
 *
 * Минуты отсюда наружу НЕ отдаются: ученику показывается только факт
 * «просмотрено» (решение владельца). Вернуть подростку самооценку после «ты
 * посмотрел 12 минут из 90» дороже, чем потом добавить цифру.
 *
 * `supabase as any` — таблица заведена миграцией §204, генерируемые типы
 * отстают (CLAUDE.md).
 */

export interface VideoWatchMark {
  maxPositionSec: number
  durationSec: number | null
}

const db = () => supabase as any

export function useVideoWatchMarks(itemIds: string[], enabled: boolean, studentProfileId: string | null) {
  const key = useMemo(() => [...new Set(itemIds)].sort().join(','), [itemIds])
  const [marks, setMarks] = useState<Record<string, VideoWatchMark>>({})

  useEffect(() => {
    if (!enabled || !studentProfileId || key === '') {
      setMarks({})
      return
    }

    let cancelled = false
    const ids = key.split(',')

    void (async () => {
      const { data, error } = await db()
        .from('video_watch_daily')
        .select('item_id, max_position, duration_seconds')
        .eq('student_id', studentProfileId)
        .in('item_id', ids)

      if (cancelled) return
      // Таблицы ещё нет или прав нет — молчим и не рисуем отметок. Отсутствие
      // отметки честнее выдуманной.
      if (error) { setMarks({}); return }

      const next: Record<string, VideoWatchMark> = {}
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const id = typeof row.item_id === 'string' ? row.item_id : null
        if (!id) continue
        const position = Number(row.max_position ?? 0)
        const duration = row.duration_seconds == null ? null : Number(row.duration_seconds)
        const prev = next[id]
        next[id] = {
          maxPositionSec: Math.max(prev?.maxPositionSec ?? 0, Number.isFinite(position) ? position : 0),
          durationSec: duration != null && Number.isFinite(duration) && duration > 0
            ? Math.max(prev?.durationSec ?? 0, duration)
            : prev?.durationSec ?? null,
        }
      }
      setMarks(next)
    })()

    return () => { cancelled = true }
  }, [key, enabled, studentProfileId])

  return marks
}
