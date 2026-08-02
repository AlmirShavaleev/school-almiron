import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { AiConfidence, AiJobStatus } from '@/lib/aiHomeworkCheck'

/**
 * Состояние ИИ-проверки для СПИСКА работ.
 *
 * Раньше узнать, разобрал ли ИИ работу, можно было только открыв её. Из-за
 * этого проверка ничего не экономила: преподаватель всё равно обходил очередь
 * подряд. Здесь состояние приезжает на список — одним запросом на все
 * видимые попытки, а не по запросу на строку.
 */
export interface QueueAiJob {
  attemptId: string
  status: AiJobStatus
  findings: number
  suggestedScore: number | null
  confidence: AiConfidence | null
  /** Черновик уже перенесён в разметку — значит, работу открывали. */
  applied: boolean
}

/** Сколько работ отправляем в модель одновременно. */
const CONCURRENCY = 3

export function useQueueAiJobs(attemptIds: string[]) {
  const [jobs, setJobs] = useState<Record<string, QueueAiJob>>({})
  const [running, setRunning] = useState<Set<string>>(new Set())
  const idsKey = attemptIds.slice().sort().join(',')

  const load = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setJobs({})
      return
    }
    // Свежая задача на попытку: сортируем по создан­ию и берём первую.
    const { data } = await supabase
      .from('topic_homework_ai_jobs')
      .select('id, attempt_id, status, suggested_score, confidence, accepted_at, created_at')
      .in('attempt_id', ids)
      .order('created_at', { ascending: false })

    const rows = (data ?? []) as {
      id: string; attempt_id: string; status: AiJobStatus
      suggested_score: number | null; confidence: AiConfidence | null
      accepted_at: string | null
    }[]

    const firstByAttempt = new Map<string, typeof rows[number]>()
    for (const r of rows) if (!firstByAttempt.has(r.attempt_id)) firstByAttempt.set(r.attempt_id, r)

    const jobIds = Array.from(firstByAttempt.values()).map(r => r.id)
    const counts = new Map<string, number>()
    if (jobIds.length > 0) {
      const { data: f } = await supabase
        .from('topic_homework_ai_findings')
        .select('job_id')
        .in('job_id', jobIds)
      for (const row of (f ?? []) as { job_id: string }[]) {
        counts.set(row.job_id, (counts.get(row.job_id) ?? 0) + 1)
      }
    }

    const next: Record<string, QueueAiJob> = {}
    for (const [attemptId, r] of firstByAttempt) {
      next[attemptId] = {
        attemptId,
        status: r.status,
        findings: counts.get(r.id) ?? 0,
        suggestedScore: r.suggested_score,
        confidence: r.confidence,
        applied: !!r.accepted_at,
      }
    }
    setJobs(next)
  }, [])

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : []
    let cancelled = false
    void load(ids).catch(() => { /* список важнее статуса ИИ */ })
    return () => { cancelled = true; void cancelled }
  }, [idsKey, load])

  // Пока хоть одна задача в работе — переспрашиваем. Опрос, а не подписка:
  // прогон живёт меньше минуты, и держать канал реального времени ради
  // нескольких строк дороже, чем раз в пять секунд сходить за статусом.
  const pollRef = useRef<number | null>(null)
  useEffect(() => {
    const busy = Object.values(jobs).some(j => j.status === 'pending' || j.status === 'processing')
    if (!busy) {
      if (pollRef.current) { window.clearTimeout(pollRef.current); pollRef.current = null }
      return
    }
    pollRef.current = window.setTimeout(() => {
      void load(idsKey ? idsKey.split(',') : [])
    }, 5000)
    return () => { if (pollRef.current) window.clearTimeout(pollRef.current) }
  }, [jobs, idsKey, load])

  /**
   * Запуск проверки. Сначала создаём задачи (строка появляется сразу и статус
   * виден), потом гоним их через модель по три штуки: параллельный залп на
   * десятке работ упирается в лимиты провайдера и начинает отдавать 429.
   */
  const runChecks = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    setRunning(new Set(ids))

    await Promise.all(ids.map(id =>
      supabase.rpc('topic_homework_ai_request_check', { p_attempt_id: id }).then(() => undefined, () => undefined),
    ))
    await load(ids)

    const queue = [...ids]
    async function worker() {
      for (;;) {
        const id = queue.shift()
        if (!id) return
        try {
          await supabase.functions.invoke('check-homework-ai', { body: { attempt_id: id } })
        } catch { /* причина осядет в job.last_error, её покажет строка */ }
        setRunning(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        await load(ids)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
    await load(ids)
    setRunning(new Set())
  }, [load])

  return { jobs, running, runChecks, reload: () => load(idsKey ? idsKey.split(',') : []) }
}
