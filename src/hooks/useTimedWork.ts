import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { parseTimedSummary, serverOffsetMs, type TimedSummary } from '@/lib/timedWork'

/**
 * §240. Время работы по времени — от СЕРВЕРА, а не от часов телефона.
 *
 * Ученик может сдвинуть часы на телефоне; окно всё равно держит база
 * (`topic_homework_window_open`). Экран лишь не должен врать: таймер
 * считается как «часы устройства + разница с сервером», разницу меряем один
 * раз при открытии (середина запроса — `serverOffsetMs`).
 *
 * RPC и новых столбцов нет в сгенерированных типах (они отстают от схемы,
 * перегенерирует оркестратор) — отсюда `as never` у вызовов, как у
 * `topic_solution_state`.
 */

interface MyWindowWire {
  timed?: boolean
  opens_at?: string | null
  closes_at?: string | null
  personal?: boolean
  server_now?: string | null
}

export interface MyTimedWindow {
  opensAt: string | null
  closesAt: string | null
  /** Личное окно («Открыть заново») вместо общего. */
  personal: boolean
}

/**
 * Действующее окно ученика (личное или общее) и разница с серверным временем.
 * `fallback` — общее окно из строки ДЗ: на него опирается предпросмотр
 * персонала (у владельца строки ученика нет, RPC ответит null) и первый кадр
 * до ответа RPC.
 */
export function useMyTimedWindow(
  homeworkId: string | null,
  fallback: { opensAt: string | null; closesAt: string | null },
  enabled = true,
) {
  // Ответ помечен своим ДЗ: сбрасывать состояние в эффекте не нужно —
  // ответ по другому ДЗ просто не используется.
  const [got, setGot] = useState<{ key: string; win: MyTimedWindow | null } | null>(null)
  const [offsetMs, setOffsetMs] = useState(0)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!homeworkId || !enabled) return
    let cancelled = false
    ;(async () => {
      const sentAt = Date.now()
      const { data } = await supabase.rpc('topic_homework_my_window' as never, { p_homework_id: homeworkId } as never)
      const receivedAt = Date.now()
      if (cancelled) return
      const wire = (data ?? null) as MyWindowWire | null
      if (wire && typeof wire === 'object') {
        setGot({ key: homeworkId, win: { opensAt: wire.opens_at ?? null, closesAt: wire.closes_at ?? null, personal: wire.personal === true } })
        if (wire.server_now) { setOffsetMs(serverOffsetMs(wire.server_now, sentAt, receivedAt)); return }
      } else {
        setGot({ key: homeworkId, win: null })
      }
      // Окна ученика нет (предпросмотр, старая база) — время всё равно серверное.
      const t0 = Date.now()
      const { data: now } = await supabase.rpc('app_server_now' as never)
      if (!cancelled && typeof now === 'string') setOffsetMs(serverOffsetMs(now, t0, Date.now()))
    })()
    return () => { cancelled = true }
  }, [homeworkId, enabled, tick])

  const win = got && got.key === homeworkId && enabled ? got.win : null
  const effective: MyTimedWindow = win ?? { opensAt: fallback.opensAt, closesAt: fallback.closesAt, personal: false }
  return { window: effective, offsetMs, reload }
}

/**
 * «Сейчас» по серверу, раз в секунду. Пока `active` ложно — не тикает (экран
 * проверенной работы таймер не показывает, перерисовывать его незачем).
 */
export function useServerNow(offsetMs: number, active: boolean, stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs)

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now() + offsetMs), stepMs)
    return () => clearInterval(id)
  }, [active, stepMs, offsetMs])

  return now
}

/** Сводка по работе для учителя: сдали сами / автоматически / не сдали / в классе. */
export function useTimedSummary(homeworkId: string | null, enabled = true) {
  const [got, setGot] = useState<{ key: string; summary: TimedSummary | null; error: string | null } | null>(null)

  useEffect(() => {
    if (!homeworkId || !enabled) return
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await supabase.rpc('topic_homework_timed_summary' as never, { p_homework_id: homeworkId } as never)
      if (cancelled) return
      setGot({ key: homeworkId, summary: err ? null : parseTimedSummary(data), error: err ? err.message : null })
    })()
    return () => { cancelled = true }
  }, [homeworkId, enabled])

  const mine = got && got.key === homeworkId && enabled ? got : null
  const summary = mine?.summary ?? null
  const error = mine?.error ?? null
  return { summary, error }
}

export interface PersonalWindowRow {
  homework_id: string
  student_id: string
  opens_at: string
  closes_at: string
}

/** Учитель: поставить ученику своё окно («Открыть заново»). */
export async function setPersonalWindow(homeworkId: string, studentId: string, opensAt: string, closesAt: string): Promise<void> {
  const { error } = await supabase.rpc('topic_homework_set_personal_window' as never, {
    p_homework_id: homeworkId, p_student_id: studentId, p_opens_at: opensAt, p_closes_at: closesAt,
  } as never)
  if (error) throw new Error(error.message)
}

/** Учитель: снять личное окно — ученику снова действует общее. */
export async function clearPersonalWindow(homeworkId: string, studentId: string): Promise<void> {
  const { error } = await supabase.rpc('topic_homework_clear_personal_window' as never, {
    p_homework_id: homeworkId, p_student_id: studentId,
  } as never)
  if (error) throw new Error(error.message)
}
