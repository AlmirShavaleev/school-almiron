import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { applyTaskTexts, isMissingFunctionError, normalizeTaskTexts } from '@/lib/catalogTaskTexts'
import type { CatalogTask, CatalogTaskAsset, CatalogViewMode } from '@/hooks/useCatalog'
import type { PhysicsDifficulty } from '@/lib/physicsDifficulty'

/**
 * Страница темы каталога одним запросом (владелец 16.10: «каталог очень долго
 * грузится»).
 *
 * Раньше тема собиралась в браузере: все id задач темы → строки задач пачками
 * по 50 → тексты §262 → рисунки пачками по 50 → «выполнено» пачками по 50.
 * Тема на 150 задач — 15–20 последовательных запросов, и всё это до первой
 * карточки. Теперь `catalog_topic_page` отдаёт порцию из 20 задач уже с
 * рисунками, отметкой и текстами по правилу §262, плюс счётчики темы; фильтры
 * «сделано / не сделано» и сложность — на сервере. Следующие 20 — тот же вызов
 * со сдвигом, по прокрутке.
 *
 * Схема без миграции (функции нет) — `missing: true`, страница идёт прежним
 * путём (`useCatalogTasks`): фронт можно выложить раньше базы.
 */

export const TOPIC_PAGE_SIZE = 20
/** Структура и счётчики каталога меняются раз в сутки — держим 5 минут. */
const TOPIC_PAGE_STALE_MS = 5 * 60 * 1000
const AI_PHYSICS_SOURCE = 'ai_physics_v1'

export type TopicFilter = 'all' | 'done' | 'todo'

export interface TopicPageStats {
  total: number
  done: number
  /** Сколько задач под текущими фильтрами. */
  filtered: number
  byDifficulty: Record<string, number>
}

interface TopicPageChunk extends TopicPageStats {
  offset: number
  tasks: CatalogTask[]
  /** §292: предмет закрыт подпиской — список пуст (как раньше под RLS). */
  locked?: boolean
}

class MissingTopicPageRpc extends Error {}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Строка задачи из ответа RPC → CatalogTask (тексты — по правилу §262, как withTaskTexts). */
export function mapTopicPageTask(raw: Record<string, unknown>): CatalogTask {
  const { texts, assets, ...row } = raw
  const task = {
    ...(row as unknown as CatalogTask),
    difficulty: (row.difficulty as PhysicsDifficulty | null | undefined) ?? null,
    assets: Array.isArray(assets) ? (assets as CatalogTaskAsset[]) : [],
    is_completed: row.is_completed === true,
  }
  return applyTaskTexts(task, normalizeTaskTexts(texts) ?? undefined)
}

export function parseTopicPage(data: unknown): TopicPageChunk {
  const d = (data ?? {}) as Record<string, unknown>
  const byDifficulty: Record<string, number> = {}
  for (const [k, v] of Object.entries((d.by_difficulty ?? {}) as Record<string, unknown>)) byDifficulty[k] = num(v)
  return {
    total: num(d.total),
    done: num(d.done),
    filtered: num(d.filtered),
    byDifficulty,
    offset: num(d.offset),
    tasks: Array.isArray(d.tasks) ? (d.tasks as Array<Record<string, unknown>>).map(mapTopicPageTask) : [],
  }
}

function isLockedError(err: { message?: string; hint?: string } | null | undefined): boolean {
  if (!err) return false
  return err.hint === 'CATALOG_LOCKED' || /откроется с подпиской/i.test(err.message ?? '')
}

const EMPTY: TopicPageChunk = { total: 0, done: 0, filtered: 0, byDifficulty: {}, offset: 0, tasks: [] }

export async function fetchTopicPage(args: {
  topicId: string
  view: CatalogViewMode
  filter: TopicFilter
  difficulties: readonly string[]
  offset: number
  limit?: number
}): Promise<TopicPageChunk> {
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string; hint?: string } | null }>
  }).rpc('catalog_topic_page', {
    p_topic_id: args.topicId,
    p_source: args.view === 'physics-topics' ? AI_PHYSICS_SOURCE : null,
    p_filter: args.filter,
    p_difficulties: args.difficulties.length ? [...args.difficulties] : null,
    p_offset: args.offset,
    p_limit: args.limit ?? TOPIC_PAGE_SIZE,
  })
  if (error) {
    if (isMissingFunctionError(error)) throw new MissingTopicPageRpc(error.message)
    if (isLockedError(error)) return { ...EMPTY, offset: args.offset, locked: true }
    throw new Error(error.message ?? 'Не удалось загрузить каталог')
  }
  return parseTopicPage(data)
}

export function topicPageKeyPrefix(userId: string | undefined, topicId: string | undefined) {
  return ['catalog-topic-page', userId ?? 'anon', topicId ?? 'none'] as const
}

export function useCatalogTopicPage(opts: {
  topicId: string | undefined
  view: CatalogViewMode
  filter: TopicFilter
  difficulties: ReadonlySet<string>
  retryKey?: number
}) {
  const profile = useAuthStore(state => state.profile)
  const queryClient = useQueryClient()
  const difficulties = useMemo(() => [...opts.difficulties].sort(), [opts.difficulties])
  const prefix = topicPageKeyPrefix(profile?.id, opts.topicId)

  const query = useInfiniteQuery({
    queryKey: [...prefix, opts.view, opts.filter, difficulties.join(','), opts.retryKey ?? 0],
    enabled: Boolean(profile?.id && opts.topicId),
    staleTime: TOPIC_PAGE_STALE_MS,
    gcTime: TOPIC_PAGE_STALE_MS * 6,
    retry: (count, err) => !(err instanceof MissingTopicPageRpc) && count < 1,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchTopicPage({
      topicId: opts.topicId!,
      view: opts.view,
      filter: opts.filter,
      difficulties,
      offset: pageParam,
    }),
    getNextPageParam: last => {
      const next = last.offset + last.tasks.length
      return last.tasks.length > 0 && next < last.filtered ? next : undefined
    },
  })

  const missing = query.error instanceof MissingTopicPageRpc
  const pages = query.data?.pages ?? []
  const first = pages[0]
  const tasks = useMemo(() => {
    const seen = new Set<string>()
    const out: CatalogTask[] = []
    for (const p of query.data?.pages ?? []) for (const t of p.tasks) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
    }
    return out
  }, [query.data])

  // «Выполнено»: та же запись, что и раньше; в кэше — сразу, без перезапроса.
  const toggleComplete = useCallback(async (taskId: string, currentlyDone: boolean) => {
    if (!profile) return
    const db = supabase as unknown as {
      from: (t: string) => {
        delete: () => { eq: (c: string, v: string) => { eq: (c: string, v: string) => PromiseLike<unknown> } }
        upsert: (row: Record<string, unknown>) => PromiseLike<unknown>
      }
    }
    if (currentlyDone) {
      await db.from('catalog_task_progress').delete().eq('user_id', profile.id).eq('task_id', taskId)
    } else {
      await db.from('catalog_task_progress')
        .upsert({ user_id: profile.id, task_id: taskId, is_completed: true, completed_at: new Date().toISOString() })
    }
    queryClient.setQueriesData<InfiniteData<TopicPageChunk, number>>({ queryKey: prefix }, old => {
      if (!old) return old
      let hit = false
      const pagesNext = old.pages.map(p => ({
        ...p,
        tasks: p.tasks.map(t => {
          if (t.id !== taskId || !!t.is_completed !== currentlyDone) return t
          hit = true
          return { ...t, is_completed: !currentlyDone }
        }),
      }))
      if (!hit) return old
      const delta = currentlyDone ? -1 : 1
      return { ...old, pages: pagesNext.map(p => ({ ...p, done: Math.max(0, p.done + delta) })) }
    })
    // Списки под другими фильтрами («сделано / не сделано») — пересобрать при следующем показе.
    void queryClient.invalidateQueries({ queryKey: prefix, refetchType: 'none' })
  }, [profile, queryClient, prefix])

  return {
    missing,
    tasks,
    stats: first
      ? { total: first.total, done: first.done, filtered: first.filtered, byDifficulty: first.byDifficulty } as TopicPageStats
      : null,
    locked: first?.locked === true,
    loading: query.isLoading,
    error: missing || !query.error ? null : (query.error instanceof Error ? query.error.message : 'Не удалось загрузить каталог'),
    hasMore: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    loadMore: () => { if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage() },
    toggleComplete,
  }
}
