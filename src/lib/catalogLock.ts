/**
 * §292 (применена на сервере 16.10): банк задач открыт по предмету подписки.
 * Закрыт ли раздел или задача — решает база (`catalog_section_allowed`,
 * `catalog_tasks_allowed`, `catalog_my_overview.exams[].locked`), здесь — только
 * чтение ответа. Сбой (нет функции, нет сети) = «открыто»: прежнее поведение,
 * а закрытое всё равно не отдадут RLS и функции.
 */
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Куда ведёт «Открыть подписку». В main страницы оформления подписки нет —
 * кнопки нет, только плашка. В ветке подписки (release-podpiska) — '/courses'.
 */
export const CATALOG_SUBSCRIBE_HREF: string | null = null

export const CATALOG_LOCKED_HINT = 'CATALOG_LOCKED'

type Rpc = { rpc?: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }

async function allowed(fn: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const db = supabase as unknown as Rpc
    if (typeof db.rpc !== 'function') return true
    const { data, error } = await db.rpc(fn, args)
    return error ? true : data !== false
  } catch {
    return true
  }
}

/** Закрыт ли раздел (страницы раздела и темы по прямой ссылке). null — ещё не знаем. */
export function useSectionLocked(sectionId: string | null | undefined): boolean | null {
  const [got, setGot] = useState<{ id: string; locked: boolean } | null>(null)
  useEffect(() => {
    if (!sectionId) return
    let alive = true
    allowed('catalog_section_allowed', { p_section_id: sectionId }).then((ok) => { if (alive) setGot({ id: sectionId, locked: !ok }) })
    return () => {
      alive = false
    }
  }, [sectionId])
  return got && got.id === sectionId ? got.locked : null
}

/** Закрыта ли задача (страница задачи по прямой ссылке). */
export function useTaskLocked(taskId: string | null | undefined): boolean | null {
  const [got, setGot] = useState<{ id: string; locked: boolean } | null>(null)
  useEffect(() => {
    if (!taskId) return
    let alive = true
    allowed('catalog_tasks_allowed', { p_task_ids: [taskId] }).then((ok) => { if (alive) setGot({ id: taskId, locked: !ok }) })
    return () => {
      alive = false
    }
  }, [taskId])
  return got && got.id === taskId ? got.locked : null
}

/** Ошибка функции банка — «закрыто по подписке» (hint CATALOG_LOCKED или его текст). */
export function isCatalogLockedError(e: unknown): boolean {
  if (!e) return false
  const x = e as { hint?: unknown; message?: unknown }
  return x.hint === CATALOG_LOCKED_HINT
    || (typeof x.message === 'string' && x.message.startsWith('Банк задач откроется с подпиской'))
    || (typeof e === 'string' && e.startsWith('Банк задач откроется с подпиской'))
}
