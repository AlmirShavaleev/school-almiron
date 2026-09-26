import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { clockOffset } from '@/lib/mockExamLesson'
import { shouldPoll, type LiveWindow, type MockExamLive } from '@/lib/mockExamLive'

/**
 * §224. Монитор идущего пробника: `mock_exam_live` опросом раз в 20 с —
 * только пока страница видима и окно не закрыто + догрузка фото. Realtime
 * не нужен: 20 секунд задержки на этом экране ничего не решают, а канал на
 * каждого открывшего таблицу стоит дороже.
 *
 * Ошибку глотаем в `error`: до применения 20260926065848_mock_exam_live_section_reminders.sql функции нет, и
 * экран тогда показывает то, что знает без неё (кто сдал, фото — §221).
 */

export const LIVE_POLL_MS = 20_000

type RpcResp<T> = PromiseLike<{ data: T | null; error: { message?: string } | null }>
interface RpcLike { rpc<T = unknown>(fn: string, args: Record<string, unknown>): RpcResp<T> }
const db = supabase as unknown as RpcLike

export function useMockExamLive(examId: string | undefined, lessonWindow: LiveWindow | null, onPoll?: () => void) {
  const [live, setLive] = useState<MockExamLive | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const onPollRef = useRef(onPoll)
  onPollRef.current = onPoll
  const offsetRef = useRef(0)
  offsetRef.current = offset

  const fetchLive = useCallback(async () => {
    if (!examId) return
    let res: { data: MockExamLive | null; error: { message?: string } | null }
    try {
      res = await db.rpc<MockExamLive>('mock_exam_live', { p_mock_exam_id: examId })
    } catch (e) {
      res = { data: null, error: { message: e instanceof Error ? e.message : 'Монитор недоступен' } }
    }
    const { data, error: err } = res
    if (err || !data) { setError(err?.message || 'Монитор недоступен'); return }
    setError(null)
    setOffset(clockOffset(data.server_now, Date.now()))
    setLive({ ...data, students: data.students ?? [] })
  }, [examId])

  const startsAt = lessonWindow?.starts_at ?? null
  const photosUntil = lessonWindow?.photos_until ?? null

  useEffect(() => {
    if (!examId || !startsAt) return
    void fetchLive()
    const w: LiveWindow = { starts_at: startsAt, ends_at: null, photos_until: photosUntil }
    const live = () => shouldPoll(w, Date.now() + offsetRef.current)
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'
    const tick = () => {
      if (!visible() || !live()) return
      void fetchLive()
      onPollRef.current?.()
    }
    const id = setInterval(tick, LIVE_POLL_MS)
    // Вернулись на вкладку — сразу свежие данные, не ждать до 20 секунд.
    const onVis = () => { if (visible()) tick() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [examId, startsAt, photosUntil, fetchLive])

  return { live, error, offset }
}
