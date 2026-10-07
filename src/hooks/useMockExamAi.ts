import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { aiRunState, isAiActive, type AiRegion, type AiRun, type AiSuggestion } from '@/lib/mockExamAi'

// Типы базы не перегенерированы после §222b — строки новых таблиц через `any` (как в useMockExamWorks).
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * §222b. Предложения ИИ по второй части пробника и состояние проверки:
 * читает `mock_exam_ai_suggestions` и `mock_exam_ai_runs` под RLS персонала
 * (ученик не видит ничего), запускает проверку и опрашивает, пока она идёт.
 *
 * Запуск — как у очереди ДЗ (useQueueAiJobs): сначала заявка
 * `mock_exam_ai_request_check` (строки «в очереди» появляются сразу, база
 * проверяет права), потом edge-функция check-mock-exam-ai по ОДНОМУ ученику
 * на вызов, не больше трёх вызовов одновременно: у каждого вызова свой
 * бюджет CPU, а залп упирается в лимиты поставщика (429).
 *
 * До применения миграции таблиц нет — ошибка чтения значит «ИИ недоступен»,
 * экран живёт как до §222b.
 */

export const AI_CONCURRENCY = 3
const POLL_MS = 5000

type Res<T> = { data: T | null; error: { message?: string } | null }
interface Chain<T> extends PromiseLike<Res<T>> {
  select(columns: string): Chain<T>
  eq(column: string, value: string): Chain<T>
}
interface DbLike {
  from<T = unknown>(table: string): Chain<T>
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): PromiseLike<Res<T>>
  functions: { invoke(name: string, opts: { body: unknown }): Promise<{ data: any; error: any }> }
}
const db = supabase as unknown as DbLike

export interface AiRequestResult {
  queued: string[]
  /** Кого не поставили и почему (идёт, нет фото…). */
  skipped: { student_id: string; outcome: string }[]
  error: string | null
}

function normRegions(raw: unknown): AiRegion[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r: any) => {
    const x = Number(r?.x), y = Number(r?.y), w = Number(r?.w), h = Number(r?.h)
    if (typeof r?.photo_id !== 'string' || ![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return []
    return [{ photo_id: r.photo_id, page: Number.isInteger(Number(r.page)) && Number(r.page) > 0 ? Number(r.page) : 1, x, y, w, h }]
  })
}

/** Текст ошибки edge-функции: supabase-js кладёт в error только «non-2xx», тело — в context. */
async function invokeError(err: any): Promise<string> {
  let detail = err?.message || 'Проверка не запустилась'
  const res = err?.context
  if (res && typeof res.json === 'function') {
    try { detail = (await res.json())?.error ?? detail } catch { /* тело не JSON */ }
  }
  return detail
}

export function useMockExamAi(examId: string | undefined) {
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([])
  const [runs, setRuns] = useState<AiRun[]>([])
  /** Таблицы §222b прочитались: ИИ доступен. */
  const [available, setAvailable] = useState(false)
  /** Ученики, чей вызов функции ещё не вернулся (в этой вкладке). */
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(new Set())
  /** «Сейчас» для сторожа зависших (10 минут): обновляется с каждым опросом. */
  const [now, setNow] = useState(() => Date.now())
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const load = useCallback(async () => {
    if (!examId) return
    const [sg, rn] = await Promise.all([
      db.from<any[]>('mock_exam_ai_suggestions').select('student_id, task_number, points, max_points, confidence, comment, regions, created_at').eq('mock_exam_id', examId),
      db.from<any[]>('mock_exam_ai_runs').select('student_id, status, last_error, note, requested_at, started_at, finished_at').eq('mock_exam_id', examId),
    ])
    if (!alive.current) return
    if (sg.error || rn.error) { setAvailable(false); return }
    setAvailable(true)
    setSuggestions((sg.data ?? []).map(r => ({
      student_id: r.student_id, task_number: Number(r.task_number), points: Number(r.points), max_points: Number(r.max_points),
      confidence: r.confidence === 'high' || r.confidence === 'medium' ? r.confidence : 'low',
      comment: r.comment ?? null, regions: normRegions(r.regions), created_at: r.created_at ?? null,
    })))
    setRuns((rn.data ?? []).map(r => ({
      student_id: r.student_id, status: r.status, last_error: r.last_error ?? null, note: r.note ?? null,
      requested_at: r.requested_at ?? null, started_at: r.started_at ?? null, finished_at: r.finished_at ?? null,
    })))
  }, [examId])

  useEffect(() => { void Promise.resolve().then(load) }, [load])

  // Пока где-то идёт проверка (в т. ч. запущенная из другой вкладки) — опрос.
  const busy = inFlight.size > 0 || runs.some(r => isAiActive(aiRunState(r, now)))
  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => { setNow(Date.now()); void load() }, POLL_MS)
    return () => clearTimeout(t)
  }, [busy, load, runs, suggestions])

  /** Проверить ИИ выбранных учеников. Ошибки отдельных учеников — в их статусе (last_error). */
  const request = useCallback(async (studentIds: string[]): Promise<AiRequestResult> => {
    if (!examId || studentIds.length === 0) return { queued: [], skipped: [], error: null }
    const { data, error } = await db.rpc<{ student_id: string; outcome: string }[]>('mock_exam_ai_request_check', {
      p_mock_exam_id: examId, p_student_ids: studentIds,
    })
    if (error) return { queued: [], skipped: [], error: error.message || 'Не удалось запустить проверку' }
    const list = Array.isArray(data) ? data : []
    const queued = list.filter(o => o.outcome === 'queued').map(o => o.student_id)
    const skipped = list.filter(o => o.outcome !== 'queued')
    if (queued.length === 0) return { queued, skipped, error: null }
    setInFlight(prev => new Set([...prev, ...queued]))
    await load()

    const queue = [...queued]
    let firstError: string | null = null
    async function worker() {
      for (;;) {
        const id = queue.shift()
        if (!id) return
        try {
          const { data: res, error: fnErr } = await db.functions.invoke('check-mock-exam-ai', { body: { mock_exam_id: examId, student_ids: [id] } })
          if (fnErr) firstError ??= await invokeError(fnErr)
          else if (res?.error) firstError ??= String(res.error)
        } catch (e: any) {
          firstError ??= e?.message || 'Проверка не запустилась'
        }
        if (alive.current) {
          setInFlight(prev => { const nx = new Set(prev); nx.delete(id); return nx })
          await load()
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(AI_CONCURRENCY, queue.length) }, worker))
    // Ошибку одного ученика экран покажет у него (last_error); общей считаем
    // только ту, что случилась у единственного запрошенного.
    return { queued, skipped, error: queued.length === 1 ? firstError : null }
  }, [examId, load])

  return { suggestions, runs, available, inFlight, now, request, reload: load }
}

export type MockExamAi = ReturnType<typeof useMockExamAi>
