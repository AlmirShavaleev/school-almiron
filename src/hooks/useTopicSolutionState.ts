import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Состояние раздела «Решение ДЗ» для ученика.
 *
 * Сами материалы решения до проверки работы не приходят вовсе — их отсекает
 * RLS (миграция 20260802000000). Но интерфейсу нужно ЗНАТЬ, что решение
 * существует и когда откроется, иначе вместо честного «откроется после
 * проверки» ученик видел бы пустоту и решал, что учитель ничего не выложил.
 *
 * Поэтому отдельная RPC, возвращающая три флага и ни одного пути к файлу.
 */
export interface TopicSolutionState {
  /** У темы есть выложенное решение. */
  hasSolution: boolean
  /** В теме вообще есть домашнее задание. */
  hasHomework: boolean
  /** Решение уже открыто этому ученику. */
  unlocked: boolean
}

const CLOSED: TopicSolutionState = { hasSolution: false, hasHomework: false, unlocked: false }

export function useTopicSolutionState(topicId: string | null | undefined) {
  const [state, setState] = useState<TopicSolutionState>(CLOSED)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!topicId) {
      setState(CLOSED)
      return
    }
    let cancelled = false
    setLoading(true)

    supabase.rpc('topic_solution_state', { p_topic_id: topicId } as never).then(({ data, error }) => {
      if (cancelled) return
      setLoading(false)
      // Отказ RPC не должен ломать страницу темы: считаем, что решения нет, —
      // это безопасная сторона ошибки.
      if (error || !data) {
        setState(CLOSED)
        return
      }
      const raw = data as { has_solution?: boolean; has_homework?: boolean; unlocked?: boolean }
      setState({
        hasSolution: !!raw.has_solution,
        hasHomework: !!raw.has_homework,
        unlocked: !!raw.unlocked,
      })
    })

    return () => { cancelled = true }
  }, [topicId])

  return { ...state, loading }
}
