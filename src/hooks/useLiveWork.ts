import { useCallback, useEffect, useRef, useState } from 'react'
import { safeRpc } from '@/lib/safeRpc'
import { LIVE_POLL_MS, liveCounters, parseLiveWork, shouldPoll, workPhase, type LiveWork } from '@/lib/liveWork'

/**
 * §263. Монитор работы по времени у учителя: `timed_work_live` и опрос раз в
 * 15 с, пока работа идёт и вкладка видна (после конца — пока чьи-то фото ещё
 * «сдаются автоматически»). Realtime не берём: экран открыт у одного учителя
 * на время работы, опрос одной функции дешевле подписок на попытки, фото и
 * отметки (и не требует публикаций и политик на realtime).
 */
export function useLiveWork(homeworkId: string | null) {
  const [data, setData] = useState<LiveWork | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [offsetMs, setOffsetMs] = useState(0)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const seq = useRef(0)

  useEffect(() => {
    if (!homeworkId) return
    const my = ++seq.current
    const sentAt = Date.now()
    void safeRpc('timed_work_live', { p_homework_id: homeworkId }).then(({ data: raw, error: err }) => {
      if (my !== seq.current) return
      setLoading(false)
      if (err) { setError(err.message); return }
      const parsed = parseLiveWork(raw)
      if (!parsed) { setError('Работа не найдена'); return }
      setError(null)
      setData(parsed)
      const server = Date.parse(parsed.serverNow)
      if (Number.isFinite(server)) setOffsetMs(server - (sentAt + Date.now()) / 2)
    })
  }, [homeworkId, tick])

  // Опрос: только пока есть что ждать и вкладка видна.
  const pollable = !!data && shouldPoll(
    workPhase(data, Date.now() + offsetMs),
    liveCounters(data.students, Date.now() + offsetMs),
    false,
  )
  useEffect(() => {
    if (!pollable) return
    const id = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      reload()
    }, LIVE_POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pollable, reload])

  return { data, error, loading, offsetMs, reload }
}
