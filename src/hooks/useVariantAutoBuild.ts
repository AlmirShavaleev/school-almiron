import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// ── Шкала уровней ────────────────────────────────────────────────────────────
// Повторяет public.variant_level_scale / variant_task_level из миграции
// 20260802232945. Держать синхронно: база — источник правды, здесь копия ради
// того, чтобы форма могла нарисовать поля до первого запроса.
//
// Шкала не одинакова, потому что данные не одинаковы: difficulty заполнена
// только у физики ЕГЭ, а has_answer почти совпадает с exam_part = 1, из-за чего
// у физики ОГЭ «сложных» с эталоном пять штук на весь предмет.

export type VariantLevelScale = 'three' | 'two' | 'none'
export type VariantLevel = 'easy' | 'medium' | 'hard' | 'basic' | 'all'

export const LEVELS_BY_SCALE: Record<VariantLevelScale, VariantLevel[]> = {
  three: ['easy', 'medium', 'hard'],
  two:   ['basic', 'hard'],
  none:  ['all'],
}

export const LEVEL_LABELS: Record<VariantLevel, string> = {
  easy:   'Лёгкие',
  medium: 'Средние',
  hard:   'Сложные',
  basic:  'Базовые',
  all:    'Всего задач',
}

/** Пояснение под раскладкой: по какому полю каталога считается уровень. */
export const SCALE_HINTS: Record<VariantLevelScale, string> = {
  three: 'Уровень берётся из разметки сложности каталога.',
  two:   'Уровней два: часть 1 экзамена — базовые, часть 2 — сложные.',
  none:  'Для этого экзамена разметки по сложности в каталоге нет — задачи берутся вперемешку.',
}

export function levelScaleFor(subjectDb: string, examTypeDb: string): VariantLevelScale {
  if (subjectDb === 'Физика' && examTypeDb === 'ЕГЭ') return 'three'
  if (subjectDb === 'Математика') return 'two'
  return 'none'
}

// ── Темы с остатками ─────────────────────────────────────────────────────────

export interface TopicAvailabilityRow {
  topic_id: string
  topic_title: string
  level: VariantLevel
  available: number
}

export interface TopicOption {
  id: string
  title: string
  parentTitle: string | null
  /** Сколько задач с эталоном по каждому уровню. Ключей может не быть вовсе. */
  byLevel: Partial<Record<VariantLevel, number>>
  total: number
}

/**
 * Список тем экзамена со счётчиками доступных задач.
 *
 * Каталог здесь только читается: справочник тем берём напрямую из
 * `catalog_topics`, счётчики — из `variant_topic_availability`.
 */
export function useVariantTopicOptions(
  subjectDb: string | undefined,
  examTypeDb: string | undefined,
  topicSource: string | null,
) {
  const { profile } = useAuthStore()
  const [topics, setTopics]   = useState<TopicOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (!profile || !subjectDb || !examTypeDb) return
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      db.rpc('variant_topic_availability', {
        p_subject:      subjectDb,
        p_exam_type:    examTypeDb,
        p_topic_ids:    null,
        p_topic_source: topicSource,
      }),
      db
        .from('catalog_topics')
        .select('id, title, parent_id, position')
        .eq('subject', subjectDb)
        .eq('exam_type', examTypeDb),
    ]).then(([availRes, topicRes]: [
      { data: TopicAvailabilityRow[] | null; error: { message: string } | null },
      { data: { id: string; title: string; parent_id: string | null; position: number }[] | null; error: { message: string } | null },
    ]) => {
      if (cancelled) return
      if (availRes.error) { setError(availRes.error.message); setLoading(false); return }

      const titleById = new Map((topicRes.data ?? []).map(t => [t.id, t.title]))
      const parentById = new Map((topicRes.data ?? []).map(t => [t.id, t.parent_id]))
      const positionById = new Map((topicRes.data ?? []).map(t => [t.id, t.position]))

      const byTopic = new Map<string, TopicOption>()
      for (const row of availRes.data ?? []) {
        let entry = byTopic.get(row.topic_id)
        if (!entry) {
          const parentId = parentById.get(row.topic_id) ?? null
          entry = {
            id: row.topic_id,
            title: row.topic_title,
            parentTitle: parentId ? titleById.get(parentId) ?? null : null,
            byLevel: {},
            total: 0,
          }
          byTopic.set(row.topic_id, entry)
        }
        entry.byLevel[row.level] = (entry.byLevel[row.level] ?? 0) + row.available
        entry.total += row.available
      }

      setTopics(
        [...byTopic.values()].sort((a, b) => {
          const byParent = (a.parentTitle ?? '').localeCompare(b.parentTitle ?? '', 'ru')
          if (byParent !== 0) return byParent
          const posDiff = (positionById.get(a.id) ?? 0) - (positionById.get(b.id) ?? 0)
          return posDiff !== 0 ? posDiff : a.title.localeCompare(b.title, 'ru')
        })
      )
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [profile, subjectDb, examTypeDb, topicSource])

  return { topics, loading, error }
}

// ── Остаток по выбранным темам ───────────────────────────────────────────────

/**
 * Сколько РАЗНЫХ задач доступно по уровням на выбранных темах.
 *
 * Отдельно от `useVariantTopicOptions`, потому что складывать счётчики тем
 * нельзя: задача связана в среднем с 1.54 темами и попадёт в сумму дважды.
 * Именно по этим числам форма гасит кнопку.
 */
export function useVariantSelectionAvailability(
  subjectDb: string | undefined,
  examTypeDb: string | undefined,
  topicIds: string[],
  topicSource: string | null,
) {
  const { profile } = useAuthStore()
  const [byLevel, setByLevel] = useState<Partial<Record<VariantLevel, number>>>({})
  const [loading, setLoading] = useState(false)

  const topicKey = useMemo(() => [...topicIds].sort().join(','), [topicIds])

  useEffect(() => {
    if (!profile || !subjectDb || !examTypeDb || !topicKey) {
      setByLevel({})
      return
    }
    let cancelled = false
    setLoading(true)

    const timer = setTimeout(() => {
      db.rpc('variant_selection_availability', {
        p_subject:      subjectDb,
        p_exam_type:    examTypeDb,
        p_topic_ids:    topicKey.split(','),
        p_topic_source: topicSource,
      }).then(({ data, error }: { data: { level: VariantLevel; available: number }[] | null; error: unknown }) => {
        if (cancelled) return
        if (error) { setByLevel({}); setLoading(false); return }
        const next: Partial<Record<VariantLevel, number>> = {}
        for (const row of data ?? []) next[row.level] = row.available
        setByLevel(next)
        setLoading(false)
      })
    }, 200)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [profile, subjectDb, examTypeDb, topicKey, topicSource])

  return { byLevel, loading }
}

// ── Сборка ───────────────────────────────────────────────────────────────────

export interface AutoBuiltTask {
  task_id: string
  topic_id: string
  section_id: string
  level: VariantLevel
  position: number
}

/** Разбор структурированных ошибок сэмплера в текст для учителя. */
export function humanizeAutoBuildError(message: string): string {
  const notEnough = message.match(/NOT_ENOUGH_LEVEL:level=([^:]+):needed=(\d+):available=(\d+)/)
  if (notEnough) {
    const label = LEVEL_LABELS[notEnough[1] as VariantLevel] ?? notEnough[1]
    return `«${label}»: запрошено ${notEnough[2]}, доступно ${notEnough[3]}. Уменьшите количество или добавьте темы.`
  }
  if (message.includes('NO_TOPICS'))     return 'Выберите хотя бы одну тему.'
  if (message.includes('INVALID_COUNT')) return 'Всего задач в тесте должно быть от 1 до 50.'
  if (message.includes('BAD_LEVEL'))     return 'Уровень не подходит этому экзамену. Обновите страницу.'
  if (message.includes('ACCESS_DENIED')) return 'Недостаточно прав для сборки теста.'
  return message
}

export function useVariantAutoBuild() {
  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const generate = useCallback(async (params: {
    subjectDb: string
    examTypeDb: string
    topicIds: string[]
    levels: Partial<Record<VariantLevel, number>>
    topicSource: string | null
  }): Promise<AutoBuiltTask[] | null> => {
    setGenerating(true)
    setError(null)
    try {
      const levels: Record<string, number> = {}
      for (const [level, cnt] of Object.entries(params.levels)) {
        if (cnt && cnt > 0) levels[level] = cnt
      }

      const { data, error: err } = await db.rpc('generate_variant_tasks_by_topic', {
        p_subject:      params.subjectDb,
        p_exam_type:    params.examTypeDb,
        p_topic_ids:    params.topicIds,
        p_levels:       levels,
        p_topic_source: params.topicSource,
      })
      if (err) throw new Error(err.message)

      const rows: {
        out_task_id: string; out_topic_id: string; out_section_id: string
        out_level: VariantLevel; out_position: number
      }[] = data ?? []

      return rows.map(r => ({
        task_id:    r.out_task_id,
        topic_id:   r.out_topic_id,
        section_id: r.out_section_id,
        level:      r.out_level,
        position:   r.out_position,
      }))
    } catch (e) {
      setError(humanizeAutoBuildError(e instanceof Error ? e.message : 'Не удалось собрать тест'))
      return null
    } finally {
      setGenerating(false)
    }
  }, [])

  return { generate, generating, error, setError }
}

// ── Счётчик прохождений ──────────────────────────────────────────────────────

export interface VariantPassCount {
  assigned: number
  passed: number
}

/**
 * Сколько человек получило вариант и сколько его прошло.
 * PostgREST не умеет group by, поэтому агрегат считает RPC.
 */
export function useVariantPassCounts(variantIds: string[]) {
  const { profile } = useAuthStore()
  const [counts, setCounts] = useState<Record<string, VariantPassCount>>({})

  const idKey = useMemo(() => [...variantIds].sort().join(','), [variantIds])

  useEffect(() => {
    if (!profile || !idKey) { setCounts({}); return }
    let cancelled = false

    db.rpc('variant_pass_counts', { p_variant_ids: idKey.split(',') })
      .then(({ data, error }: {
        data: { variant_id: string; assigned_count: number; passed_count: number }[] | null
        error: unknown
      }) => {
        if (cancelled || error) return
        const next: Record<string, VariantPassCount> = {}
        for (const row of data ?? []) {
          next[row.variant_id] = { assigned: row.assigned_count, passed: row.passed_count }
        }
        setCounts(next)
      })

    return () => { cancelled = true }
  }, [profile, idKey])

  return counts
}
