import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  aiErrorMessage,
  isRunning,
  type AiFindingRow,
  type AiJobRow,
} from '@/lib/aiHomeworkCheck'

/**
 * Черновик ИИ-проверки одной попытки: последний прогон и его находки.
 *
 * Запуск идёт через Edge Function `check-homework-ai`, а не прямой записью:
 * клиенту писать в topic_homework_ai_* нельзя ни политикой, ни грантом
 * (миграция 20260730225142). Права на запуск проверяет база внутри
 * topic_homework_ai_request_check.
 */
export function useHomeworkAiCheck(attemptId: string | null) {
  const [job, setJob] = useState<AiJobRow | null>(null)
  const [findings, setFindings] = useState<AiFindingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    // Последний прогон, а не все: перепроверок может быть несколько, но
    // преподавателю нужен свежий результат, а не история попыток.
    const { data: jobs, error: jobErr } = await supabase
      .from('topic_homework_ai_jobs')
      .select('*')
      .eq('attempt_id', id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (jobErr) throw new Error(jobErr.message)
    const latest = (jobs?.[0] ?? null) as AiJobRow | null
    setJob(latest)

    if (!latest || latest.status !== 'done') {
      setFindings([])
      return latest
    }

    const { data: rows, error: findErr } = await supabase
      .from('topic_homework_ai_findings')
      .select('*')
      .eq('job_id', latest.id)
      .order('position')

    if (findErr) throw new Error(findErr.message)
    setFindings((rows ?? []) as AiFindingRow[])
    return latest
  }, [])

  useEffect(() => {
    if (!attemptId) { setJob(null); setFindings([]); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    load(attemptId)
      .catch(e => { if (!cancelled) setError(aiErrorMessage(e?.message)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [attemptId, load])

  /**
   * Запускает проверку и дожидается результата.
   *
   * Функция работает синхронно — вызов модели занимает десятки секунд, и это
   * терпимо, пока проверку запускает человек кнопкой. Очередь с воркером в
   * базе уже есть (claim_topic_homework_ai_jobs), она понадобится, когда
   * проверка станет фоновой при сдаче.
   */
  const runCheck = useCallback(async () => {
    if (!attemptId || running) return
    setRunning(true)
    setError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('check-homework-ai', {
        body: { attempt_id: attemptId },
      })
      // Edge Function отдаёт осмысленный текст ошибки телом ответа, а
      // supabase-js кладёт в fnErr только «non-2xx». Достаём тело.
      if (fnErr) {
        let detail = fnErr.message
        const res = (fnErr as any)?.context
        if (res && typeof res.json === 'function') {
          try { detail = (await res.json())?.error ?? detail } catch { /* тело не JSON */ }
        }
        throw new Error(detail)
      }
      if ((data as any)?.error) throw new Error((data as any).error)
      await load(attemptId)
    } catch (e: any) {
      setError(aiErrorMessage(e?.message))
      // Строка задачи могла остаться в failed — подтягиваем её, чтобы
      // преподаватель видел причину и в панели, а не только всплывающей строкой.
      try { await load(attemptId) } catch { /* уже показали ошибку */ }
    } finally {
      setRunning(false)
    }
  }, [attemptId, running, load])

  const markAccepted = useCallback(async (jobId: string) => {
    const { error: err } = await supabase.rpc('topic_homework_ai_mark_accepted', { p_job_id: jobId })
    if (err) throw new Error(err.message)
    setJob(prev => (prev && prev.id === jobId ? { ...prev, accepted_at: new Date().toISOString() } : prev))
  }, [])

  return {
    job,
    findings,
    loading,
    running: running || isRunning(job),
    error,
    runCheck,
    markAccepted,
  }
}
