import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/**
 * Связь темы с каркасом курса (§172).
 *
 * Две стороны одной линейки: тема каркаса знает, в каких классах она видна;
 * тема класса знает, что она отражение и правится в шаблоне. Плюс расхождения,
 * которые не удалось повторить, — их преподаватель должен видеть, а не искать.
 */

export interface TemplateCopy {
  topic_id: string
  course: string
}

export interface TemplateIssue {
  id: string
  kind: 'kept_with_answers' | 'delete_kept' | 'hw_conflict' | string
  detail: string | null
  course: string
}

export interface TopicTemplateLink {
  is_template: boolean
  source_topic_id: string | null
  source_course: string | null
  copies: TemplateCopy[]
  issues: TemplateIssue[]
}

const EMPTY: TopicTemplateLink = {
  is_template: false, source_topic_id: null, source_course: null, copies: [], issues: [],
}

export function useTopicTemplateLink(topicId: string | undefined | null) {
  const [link, setLink]   = useState<TopicTemplateLink>(EMPTY)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!topicId) { setLink(EMPTY); return }
    try {
      const { data, error: err } = await db.rpc('topic_template_link', { p_topic_id: topicId })
      if (err) throw new Error(err.message)
      // Не персонал курса — RPC вернёт пусто; экран просто не покажет плашку.
      setLink(data ? { ...EMPTY, ...data } : EMPTY)
    } catch {
      // Сорвавшаяся подпись не должна ронять окно темы.
      setLink(EMPTY)
    }
  }, [topicId])

  useEffect(() => { void load() }, [load])

  /** Кнопка «Повторить» на плашке расхождений. */
  const repeat = useCallback(async () => {
    if (!topicId) return false
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await db.rpc('template_sync_topic', { p_template_topic_id: topicId })
      if (err) throw new Error(err.message.includes('ACCESS_DENIED') ? 'Нет прав на эту тему курса.' : err.message)
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось повторить')
      return false
    } finally {
      setBusy(false)
    }
  }, [topicId, load])

  return { link, busy, error, repeat, reload: load }
}
