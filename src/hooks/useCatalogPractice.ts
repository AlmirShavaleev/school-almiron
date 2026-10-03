import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  checkErrorText, normalizeCheckResult, normalizePracticeState,
  type CheckResult, type ForecastChange, type PracticeState,
} from '@/lib/catalogRewards'
import { forecastChange, normalizeForecastResponse, type ForecastResponse } from '@/lib/egeForecast'
import { revealCatalogTaskTexts, type CatalogTaskTexts } from '@/lib/catalogTaskTexts'

/**
 * §256. Каталог глазами ученика: проверка ответа, раскрытие, зона номера.
 *
 * Всё считает база: `catalog_practice_state` (номер раздела, зона, вехи,
 * состояние задач страницы), `catalog_check_answer` (вердикт — правило
 * вариантов §63/§66, засчитано ли, награды), `catalog_reveal_answers`
 * (раскрытие: дальше задача не засчитывается; §262 — заодно тексты ответа и
 * разбора по правилу сервера). Клиент только показывает.
 *
 * «+1 к прогнозу» — модель §255 до/после: свидетельства берём у
 * `student_exam_forecast_evidence` до проверки и ещё раз после неё (когда
 * попытка что-то поменяла в свидетельствах). Своей копии правила «как
 * попытка идёт в прогноз» на клиенте нет — второй запрос дешевле, чем
 * расхождение.
 *
 * Тип вызова — свой: сгенерированные типы базы отстают от прода (CLAUDE.md).
 */
type Res<T> = { data: T | null; error: { message?: string } | null }
interface RpcLike { rpc?: <T = unknown>(fn: string, args?: Record<string, unknown>) => PromiseLike<Res<T>> }

const db = () => supabase as unknown as RpcLike

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T | null> {
  const c = db()
  if (typeof c.rpc !== 'function') throw new Error('rpc недоступен')
  const { data, error } = await c.rpc<T>(fn, args)
  if (error) throw new Error(error.message ?? 'Ошибка базы')
  return data
}

const FORECAST_SUBJECTS = new Set(['math', 'physics'])

export interface CheckOutcome {
  result: CheckResult | null
  /** Изменение прогноза (null — не считается или ещё не пересчитан). */
  change: ForecastChange | null
  error:  string | null
}

export function useCatalogPractice(sectionId: string | null | undefined, taskIds: readonly string[], enabled: boolean) {
  const [state, setState] = useState<PracticeState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const forecastRef = useRef<ForecastResponse | null>(null)
  const idsKey = taskIds.join(',')

  useEffect(() => {
    let cancelled = false
    async function load() {
      await Promise.resolve()
      if (cancelled) return
      if (!enabled || !sectionId) { setState(null); return }
      try {
        const raw = await call<unknown>('catalog_practice_state', { p_section_id: sectionId, p_task_ids: idsKey ? idsKey.split(',') : [] })
        if (cancelled) return
        const parsed = normalizePracticeState(raw)
        setState(parsed)
        setError(null)
        // Прогноз «до» — только для ЕГЭ математики/физики.
        if (parsed?.number && FORECAST_SUBJECTS.has(parsed.number.subject) && !forecastRef.current) {
          try {
            forecastRef.current = normalizeForecastResponse(await call<unknown>('student_exam_forecast_evidence'))
          } catch {
            forecastRef.current = null
          }
        }
      } catch (e) {
        if (cancelled) return
        // Функции ещё нет (миграция не применена) — каталог работает как раньше.
        setState(null)
        setError(e instanceof Error ? e.message : 'Не удалось загрузить состояние')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [sectionId, idsKey, enabled])

  const check = useCallback(async (taskId: string, answer: string): Promise<CheckOutcome> => {
    let result: CheckResult | null
    try {
      result = normalizeCheckResult(await call<unknown>('catalog_check_answer', { p_task_id: taskId, p_answer: answer }))
    } catch (e) {
      return { result: null, change: null, error: checkErrorText(e instanceof Error ? e.message : null) }
    }
    if (!result) return { result: null, change: null, error: checkErrorText(null) }
    const r = result
    setState(s => {
      if (!s) return s
      const prev = s.tasks[taskId]
      const tasks = prev
        ? {
            ...s.tasks,
            [taskId]: {
              ...prev,
              attempts: prev.attempts + (r.alreadySolved ? 0 : 1),
              lastVerdict: r.verdict,
              solved: prev.solved || r.verdict === 'correct',
              counted: prev.counted || r.counted,
            },
          }
        : s.tasks
      const number = s.number && r.solved != null && r.n === s.number.n && r.subject === s.number.subject
        ? { ...s.number, solved: r.solved }
        : s.number
      return { ...s, tasks, number }
    })
    // Свидетельства поменялись только у новой попытки без открытого ответа.
    let change: ForecastChange | null = null
    const subject = r.subject
    if (!r.alreadySolved && !r.revealedBefore && subject && FORECAST_SUBJECTS.has(subject)) {
      try {
        const before = forecastRef.current
        const after = normalizeForecastResponse(await call<unknown>('student_exam_forecast_evidence'))
        change = forecastChange(before, after, subject)
        if (after) forecastRef.current = after
      } catch {
        change = null
      }
    }
    return { result: r, change, error: null }
  }, [])

  // §262: раскрытие и тексты одним вызовом (`catalog_reveal_answers`) — ответ,
  // решение, план и критерии приходят только отсюда, в строке задачи их нет.
  const reveal = useCallback(async (taskId: string): Promise<CatalogTaskTexts | null> => {
    const texts = (await revealCatalogTaskTexts([taskId])).get(taskId) ?? null
    setState(s => (s && s.tasks[taskId] ? { ...s, tasks: { ...s.tasks, [taskId]: { ...s.tasks[taskId], revealed: true } } } : s))
    return texts
  }, [])

  return { state, error, check, reveal }
}
