import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

/**
 * Сопоставление тем курса с темами каталога и массовая сборка тестов.
 *
 * Правила живут в базе, не здесь: годность темы под тест
 * (`course_topic_test_kind`), число доступных задач
 * (`topic_catalog_part1_task_count`), отбор задач и защита от повторов
 * (`build_topic_tests_for_course`). Хук только возит данные — иначе появятся
 * две копии правил, которые разъедутся (§62, §66).
 */

/** Годность темы под тест. Часть указана в самом названии темы курса. */
export type TopicTestKind = 'part1' | 'candidate' | 'part2' | 'theory' | 'method'

export const KIND_LABELS: Record<TopicTestKind, string> = {
  part1:     'Первая часть',
  candidate: 'Можно собрать',
  part2:     'Вторая часть',
  theory:    'Теория',
  method:    'Методическая',
}

/** Почему по теме тест не собирается. NULL — собирается. */
export const KIND_BLOCKED: Partial<Record<TopicTestKind, string>> = {
  part2:  'Вторая часть — автопроверяемых задач нет ни одной',
  theory: 'Теория — тест не предполагается',
  method: 'Методическая тема',
}

export interface TopicOverviewRow {
  topic_id: string
  module_title: string
  topic_title: string
  order_key: number
  kind: TopicTestKind
  linked_count: number
  available: number
  has_test: boolean
}

export interface CatalogTopicOption {
  catalog_topic_id: string
  title: string
  available: number
  score?: number
}

export interface TopicLink {
  id: string
  topic_id: string
  catalog_topic_id: string
  source: string | null
  title: string
}

export interface BuildRow {
  topic_id: string
  topic_title: string
  status: 'built' | 'skipped_kind' | 'skipped_has_test' | 'no_link' | 'no_tasks'
  built: number
  note: string | null
}

export function useCourseTopicTests(courseId: string | undefined) {
  const [rows, setRows]       = useState<TopicOverviewRow[]>([])
  const [links, setLinks]     = useState<TopicLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState(false)

  const load = useCallback(async () => {
    if (!courseId) return
    setLoading(true)
    setError(null)

    const [overviewRes, linksRes] = await Promise.all([
      db.rpc('course_topic_test_overview', { p_course_id: courseId }),
      db
        .from('topic_catalog_topics')
        .select('id, topic_id, catalog_topic_id, source, catalog_topics(title)'),
    ])

    if (overviewRes.error) { setError(overviewRes.error.message); setLoading(false); return }
    setRows(overviewRes.data ?? [])

    // RLS сама оставит только связи тем, доступных этому пользователю.
    setLinks(((linksRes.data ?? []) as {
      id: string; topic_id: string; catalog_topic_id: string; source: string | null
      catalog_topics?: { title: string } | null
    }[]).map(l => ({
      id: l.id,
      topic_id: l.topic_id,
      catalog_topic_id: l.catalog_topic_id,
      source: l.source,
      title: l.catalog_topics?.title ?? '—',
    })))

    setLoading(false)
  }, [courseId])

  useEffect(() => { void load() }, [load])

  const linksByTopic = useMemo(() => {
    const map = new Map<string, TopicLink[]>()
    for (const l of links) {
      const list = map.get(l.topic_id) ?? []
      list.push(l)
      map.set(l.topic_id, list)
    }
    return map
  }, [links])

  const addLink = useCallback(async (topicId: string, catalogTopicId: string) => {
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await db.from('topic_catalog_topics').insert({
        topic_id: topicId,
        catalog_topic_id: catalogTopicId,
        source: 'ai_physics_v1',
      })
      // Повторная привязка той же темы — не ошибка, просто ничего не меняет.
      if (err && !String(err.message).includes('duplicate')) throw new Error(err.message)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось связать тему')
    } finally {
      setBusy(false)
    }
  }, [load])

  const removeLink = useCallback(async (linkId: string) => {
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await db.from('topic_catalog_topics').delete().eq('id', linkId)
      if (err) throw new Error(err.message)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось убрать связь')
    } finally {
      setBusy(false)
    }
  }, [load])

  const build = useCallback(async (count: number, rebuild: boolean): Promise<BuildRow[] | null> => {
    if (!courseId) return null
    setBusy(true)
    setError(null)
    try {
      const { data, error: err } = await db.rpc('build_topic_tests_for_course', {
        p_course_id: courseId,
        p_count:     count,
        p_rebuild:   rebuild,
      })
      if (err) throw new Error(humanizeBuildError(err.message))
      await load()
      return (data ?? []) as BuildRow[]
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось собрать тесты')
      return null
    } finally {
      setBusy(false)
    }
  }, [courseId, load])

  return { rows, linksByTopic, loading, error, busy, addLink, removeLink, build, reload: load }
}

export function humanizeBuildError(message: string): string {
  if (message.includes('NO_GROUPS'))     return 'У курса нет группы — выдавать тесты некому.'
  if (message.includes('INVALID_COUNT')) return 'Задач в тесте должно быть от 1 до 50.'
  if (message.includes('ACCESS_DENIED')) return 'Недостаточно прав.'
  return message
}

/** Кандидаты для одной темы. Грузятся по раскрытию строки, а не для всех 169 сразу. */
export function useTopicSuggestions(topicId: string | null) {
  const [items, setItems]     = useState<CatalogTopicOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!topicId) { setItems([]); return }
    let cancelled = false
    setLoading(true)
    db.rpc('topic_catalog_suggestions', { p_topic_id: topicId, p_limit: 5 })
      .then(({ data }: { data: CatalogTopicOption[] | null }) => {
        if (cancelled) return
        setItems(data ?? [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [topicId])

  return { items, loading }
}

/** Поиск по дереву — для тем, у которых уверенных кандидатов нет. */
export function useAiTopicSearch(search: string, enabled: boolean) {
  const [items, setItems]     = useState<CatalogTopicOption[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) { setItems([]); return }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      db.rpc('ai_physics_topics_list', { p_search: search || null, p_limit: 30 })
        .then(({ data }: { data: CatalogTopicOption[] | null }) => {
          if (cancelled) return
          setItems(data ?? [])
          setLoading(false)
        })
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [search, enabled])

  return { items, loading }
}
