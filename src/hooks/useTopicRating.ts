import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchMyTopicRating, rateTopic } from '@/lib/topicRatings'

interface RatingState {
  /** Для какой темы состояние: сменилась тема — прежнее не показываем. */
  topicId: string
  rating: number | null
  loaded: boolean
  saving: boolean
  saved: boolean
  error: string | null
}

/**
 * §271. Своя оценка урока (1–10) и её смена.
 *
 * В предпросмотре (§178) не уходит ни одного запроса: строки `students` у
 * персонала нет, ставить оценку не за кого — блок показывается выключенным.
 * Сбой чтения не ломает страницу темы: блок просто остаётся без оценки.
 */
export function useTopicRating(topicId: string | null | undefined, opts: { preview: boolean }) {
  const { preview } = opts
  const [state, setState] = useState<RatingState | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = state && state.topicId === topicId ? state : null

  useEffect(() => {
    if (!topicId || preview) return
    let cancelled = false
    fetchMyTopicRating(topicId).then(res => {
      if (cancelled) return
      setState({ topicId, rating: res.rating, loaded: true, saving: false, saved: false, error: null })
    })
    return () => { cancelled = true }
  }, [topicId, preview])

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  const rating = current?.rating ?? null
  const saving = !!current?.saving

  const rate = useCallback(async (value: number) => {
    if (!topicId || preview || saving) return
    const prev = rating
    // Звёзды закрашиваются сразу; сбой — возвращаем прежнюю оценку.
    setState({ topicId, rating: value, loaded: true, saving: true, saved: false, error: null })
    const res = await rateTopic(topicId, value)
    if (res.error) {
      setState({ topicId, rating: prev, loaded: true, saving: false, saved: false, error: res.error })
      return
    }
    setState({ topicId, rating: res.rating, loaded: true, saving: false, saved: true, error: null })
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => {
      setState(s => (s && s.topicId === topicId ? { ...s, saved: false } : s))
    }, 4000)
  }, [topicId, preview, saving, rating])

  return {
    rating,
    loading: !preview && !!topicId && !current?.loaded,
    saving,
    saved: !!current?.saved,
    error: current?.error ?? null,
    rate,
  }
}
