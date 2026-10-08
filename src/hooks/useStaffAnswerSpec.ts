import { useEffect, useState } from 'react'
import { safeRpc } from '@/lib/safeRpc'
import { parseAnswerSpec, type AnswerSpec } from '@/lib/catalogAnswerSpec'

/**
 * §269. Эталон ответа с допуском — ТОЛЬКО персоналу (`catalog_task_answer_specs`,
 * ученику база отвечает отказом, колонка `answer_spec` закрыта правами).
 * Зовётся, когда персонал раскрыл ответ задачи в Markdown; результат кэшируется
 * на сессию вкладки. Сбой / нет функции (миграция не применена) — null, строки
 * допуска просто нет.
 */
const cache = new Map<string, AnswerSpec | null>()

export function useStaffAnswerSpec(taskId: string, enabled: boolean): AnswerSpec | null {
  // Значение живёт в кэше; состояние — только «пришёл ответ, перерисуй».
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (!enabled || cache.has(taskId)) return
    let cancelled = false
    void safeRpc('catalog_task_answer_specs', { p_task_ids: [taskId] }).then(({ data, error }) => {
      if (error) return // не кэшируем сбой: следующее раскрытие спросит снова
      const row = Array.isArray(data) ? (data as Array<{ task_id?: string; answer_spec?: unknown }>).find(r => r.task_id === taskId) : null
      cache.set(taskId, parseAnswerSpec(row?.answer_spec))
      if (!cancelled) setVersion(v => v + 1)
    })
    return () => { cancelled = true }
  }, [taskId, enabled])

  return enabled ? cache.get(taskId) ?? null : null
}

/** Только для тестов. */
export function __resetStaffAnswerSpecCache() {
  cache.clear()
}
