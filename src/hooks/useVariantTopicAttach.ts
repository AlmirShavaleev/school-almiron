import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/**
 * Привязка тестирования из раздела «Тесты» к теме курса (§58).
 *
 * Привязка — это настоящая выдача группам курса, а не отдельная пометка показа:
 * иначе тест на теме вечно показывал бы «ещё никто не прошёл», хотя ученики его
 * решают. Курс может состоять из нескольких групп, поэтому группы выбираются.
 */

export interface TopicGroupOption {
  group_id: string
  group_name: string
  student_count: number
}

export interface AttachedVariant {
  variant_id: string
  title: string
  subject: string
  exam_type: string
  tasks_count: number
  group_count: number
  assigned_count: number
  passed_count: number
}

export function useTopicVariantAttachment(topicId: string | undefined) {
  const [attached, setAttached] = useState<AttachedVariant[]>([])
  const [groups, setGroups]     = useState<TopicGroupOption[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)

  const load = useCallback(async () => {
    if (!topicId) return
    setLoading(true)
    setError(null)
    const [attachedRes, groupsRes] = await Promise.all([
      db.rpc('topic_attached_variants', { p_topic_id: topicId }),
      db.rpc('variant_topic_groups', { p_topic_id: topicId }),
    ])
    if (attachedRes.error) setError(attachedRes.error.message)
    setAttached(attachedRes.data ?? [])
    setGroups(groupsRes.data ?? [])
    setLoading(false)
  }, [topicId])

  useEffect(() => { void load() }, [load])

  const attach = useCallback(async (variantId: string, groupIds: string[], dueAt: string | null) => {
    if (!topicId) return
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await db.rpc('attach_variant_to_topic', {
        p_variant_id: variantId,
        p_topic_id:   topicId,
        p_group_ids:  groupIds,
        p_due_at:     dueAt,
      })
      if (err) throw new Error(humanizeAttachError(err.message))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось привязать тестирование')
      throw e
    } finally {
      setBusy(false)
    }
  }, [topicId, load])

  const detach = useCallback(async (variantId: string) => {
    if (!topicId) return
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await db.rpc('detach_variant_from_topic', {
        p_variant_id: variantId,
        p_topic_id:   topicId,
      })
      if (err) throw new Error(humanizeAttachError(err.message))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось открепить тестирование')
      throw e
    } finally {
      setBusy(false)
    }
  }, [topicId, load])

  return { attached, groups, loading, error, busy, attach, detach, reload: load }
}

export function humanizeAttachError(message: string): string {
  const started = message.match(/HAS_ATTEMPTS:started=(\d+)/)
  if (started) {
    return `Тестирование уже начали ${started[1]} чел. Открепить нельзя — ответы учеников пропадут вместе с выдачей.`
  }
  if (message.includes('FOREIGN_GROUP')) return 'Эта группа не относится к курсу темы.'
  if (message.includes('NO_GROUPS'))     return 'Выберите хотя бы одну группу.'
  if (message.includes('NO_VARIANT'))    return 'Тестирование не найдено.'
  if (message.includes('ACCESS_DENIED')) return 'Нет прав на эту тему курса.'
  return message
}
