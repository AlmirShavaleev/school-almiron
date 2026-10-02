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
 * §258. Окно работы по времени для СТРАНИЦЫ темы: замок на «Условии» и
 * плашка предпросмотра. Данные — те же, что у `TopicTimedWorkStudent`:
 * строка ДЗ темы (общее окно) и `useMyTimedWindow` (личное окно ученика и
 * серверное время). Вместо тиканья раз в секунду — один таймер на момент
 * открытия: страница перерисовывается ровно тогда, когда окно открылось.
 *
 * `opened` — окно уже началось по серверному времени. Это ровно то правило,
 * по которому база отдаёт условие ученику без сданной работы
 * (`topic_homework_condition_open`); предпросмотр — как раз такой ученик.
 */
export function useTopicTimedWindow(topicId: string | null, enabled: boolean, preview: boolean) {
  const [got, setGot] = useState<{ key: string; row: { id: string; opens_at: string | null; closes_at: string | null } | null } | null>(null)

  useEffect(() => {
    if (!topicId || !enabled) return
    let cancelled = false
    // `*`, а не перечень: так же читает строку `useTopicHomework`.
    supabase.from('topic_homework').select('*').eq('topic_id', topicId).maybeSingle().then(({ data }) => {
      if (cancelled) return
      const raw = (data ?? null) as { id?: string; opens_at?: string | null; closes_at?: string | null; is_published?: boolean } | null
      // Черновик ДЗ ученику не виден (§250) — в предпросмотре его как бы нет.
      const row = raw?.id && !(preview && raw.is_published === false)
        ? { id: raw.id, opens_at: raw.opens_at ?? null, closes_at: raw.closes_at ?? null }
        : null
      setGot({ key: topicId, row })
    })
    return () => { cancelled = true }
  }, [topicId, enabled, preview])

  const mine = got && got.key === topicId && enabled ? got : null
  const row = mine?.row ?? null
  const { window: win, offsetMs } = useMyTimedWindow(
    row?.id ?? null,
    { opensAt: row?.opens_at ?? null, closesAt: row?.closes_at ?? null },
    enabled && !!row,
  )

  const opensMs = win.opensAt ? Date.parse(win.opensAt) : NaN
  const [, rerender] = useState(0)
  useEffect(() => {
    if (!enabled || !Number.isFinite(opensMs)) return
    const wait = opensMs - (Date.now() + offsetMs)
    if (wait <= 0) return
    // setTimeout держит не больше ~24,8 суток; дальше — перезапуск эффекта не
    // нужен: страницу столько не держат открытой.
    const id = setTimeout(() => rerender(n => n + 1), Math.min(wait + 50, 2 ** 31 - 1))
    return () => clearTimeout(id)
  }, [enabled, opensMs, offsetMs])

  const opened = Number.isFinite(opensMs) && Date.now() + offsetMs >= opensMs
  return {
    /** Строка ДЗ прочитана (или читать нечего). */
    loaded: !enabled || !!mine,
    opensAt: win.opensAt,
    closesAt: win.closesAt,
    opened,
  }
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
