import { useEffect, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { physicsDifficultyByExternalId, getPhysicsDifficultyOrder, type PhysicsDifficulty } from '@/lib/physicsDifficulty'
import { physicsTopicsCatalog } from '@/lib/physicsTopicsCatalog'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CatalogSection {
  id: string
  external_id: number
  subject: string
  exam_type: string
  exam_number: number | null
  title: string
  position: number
  task_count?: number
  part1_count?: number
  part2_count?: number
  completed_count?: number
}

export interface CatalogTopic {
  id: string
  external_id: number
  parent_id: string | null
  title: string
  slug: string | null
  position: number
  children?: CatalogTopic[]
  task_count?: number
  completed_count?: number
}

export interface CatalogTaskAsset {
  id: string
  tex_session_id: number | null
  kind: string
  storage_path: string
  alt: string | null
  position: number
}

export interface CatalogTask {
  id: string
  external_id: number
  section_id: string
  subject: string
  exam_type: string
  difficulty?: PhysicsDifficulty | null
  partial_type?: 'multi_choice' | 'matching' | null
  max_points?: number | null
  statement_html: string
  answer_html: string | null
  solution_html: string | null
  solution_plan_html: string | null
  grade_criteria_html: string | null
  source_url?: string | null
  has_answer: boolean
  has_solution: boolean
  position: number
  exam_part?: number | null
  assets?: CatalogTaskAsset[]
  is_completed?: boolean
  section?: CatalogSection
}

export interface CatalogTaskTopicLink {
  task_id: string
  topic_id: string
  is_primary: boolean
  source: string | null
  topic: {
    id: string
    external_id: number
    title: string
  } | null
}

export interface PhysicsTopicEditorOption {
  id: string
  external_id: number
  title: string
  sectionTitle: string
}

export type CatalogViewMode = 'exam' | 'physics-topics'

// Maps display subject name → URL slug and back
export const SUBJECT_SLUGS: Record<string, string> = {
  'Математика': 'math',
  'Физика':     'physics',
}
export const SUBJECT_FROM_SLUG: Record<string, string> = {
  'math':    'Математика',
  'physics': 'Физика',
}
export const ALL_SUBJECTS = ['Математика', 'Физика'] as const

// Maps display exam type → URL slug and back
export const EXAM_SLUGS: Record<string, string> = {
  'ЕГЭ': 'ege',
  'ОГЭ': 'oge',
}
export const EXAM_FROM_SLUG: Record<string, string> = {
  'ege': 'ЕГЭ',
  'oge': 'ОГЭ',
}
// Exams available per subject (slug → slug[])
export const EXAMS_FOR_SUBJECT: Record<string, string[]> = {
  'math':    ['ege', 'oge'],
  'physics': ['ege', 'oge'],
}
// Default exam slug per subject slug
export const DEFAULT_EXAM: Record<string, string> = {
  'math':    'ege',
  'physics': 'ege',
}

// Catalog tables are not yet in the generated DB types — use untyped client
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// ── Supabase Storage URL helper ───────────────────────────────────────────────

const BUCKET = 'catalog-assets'
const AI_PHYSICS_SOURCE = 'ai_physics_v1'
const AI_PHYSICS_ROOT_EXTERNAL_ID = 900000
const AI_PHYSICS_MAX_EXTERNAL_ID = 900712
const IN_FILTER_CHUNK = 50
const PHYSICS_TOPICS_CACHE_MS = 5 * 60 * 1000
/**
 * Структура каталога (разделы, темы, число задач) меняется только при заливке
 * новых задач, то есть раз в недели. Прогресс ученика едет чаще, но он входит
 * в те же RPC, поэтому кэш держим умеренным: 5 минут достаточно, чтобы
 * переходы «раздел → тема → назад» были мгновенными, и при этом отмеченная
 * задача отражается в счётчиках без перезагрузки страницы.
 */
const CATALOG_STRUCTURE_CACHE_MS = 5 * 60 * 1000
const AI_PHYSICS_SECTION_META: Record<number, string> = {
  1: 'Механика',
  2: 'МКТ и термодинамика',
  3: 'Электростатика',
  4: 'Постоянный ток',
  5: 'Магнетизм и ЭМИ',
  6: 'Оптика',
  7: 'Квантовая и атомная',
}
const SELECT_PAGE_SIZE = 1000

function getPhysicsEditorSectionTitle(externalId: number): string {
  const sectionNumber = getPhysicsSectionNumber(externalId)
  return sectionNumber ? AI_PHYSICS_SECTION_META[sectionNumber] ?? 'Физические темы' : 'Физические темы'
}

function getCatalogPhysicsQueryKeys(userId?: string, retryKey?: number, sectionId?: string, topicId?: string) {
  return {
    sections: ['catalog-physics-topic-sections', userId ?? 'anon', retryKey ?? 0] as const,
    sectionTopics: ['catalog-physics-section-topics', userId ?? 'anon', sectionId ?? 'none', retryKey ?? 0] as const,
    topicTasks: ['catalog-physics-topic-tasks', userId ?? 'anon', topicId ?? 'none', retryKey ?? 0] as const,
  }
}

/**
 * Темы раздела одним запросом.
 *
 * Раньше это считалось в браузере: выкачать все id задач раздела, разбить на
 * пачки по 50 и на каждую сделать отдельный запрос к связям, потом ещё раз
 * пачками — за прогрессом. На разделе в 1036 задач получалось ~32
 * последовательных запроса; при задержке 150–250 мс это 5–8 секунд.
 * RPC get_catalog_section_topic_tree делает ту же группировку в базе за 11 мс.
 */
async function loadSectionTopicTree(sectionId: string): Promise<CatalogTopic[]> {
  const { data, error } = await db.rpc('get_catalog_section_topic_tree', {
    p_section_id: sectionId,
  })
  if (error) throw new Error(error.message ?? 'Не удалось загрузить каталог')
  return ((data ?? []) as Array<{
    id: string
    external_id: number
    parent_id: string | null
    title: string
    slug: string | null
    position: number
    task_count: number
    completed_count: number
  }>).map(row => ({
    id: row.id,
    external_id: row.external_id,
    parent_id: row.parent_id,
    title: row.title,
    slug: row.slug,
    position: row.position,
    task_count: row.task_count ?? 0,
    completed_count: row.completed_count ?? 0,
  }))
}

function isMissingCatalogTopicPublishedColumn(error: unknown): boolean {
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : ''
  return message.includes('is_published') && message.includes('catalog_topics')
}

async function fetchCatalogTopicsWithPublishedFallback(
  buildQuery: (includePublishedFilter: boolean) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>
) {
  const first = await buildQuery(true)
  if (!isMissingCatalogTopicPublishedColumn(first.error)) return first
  return buildQuery(false)
}

function getPhysicsSectionNumber(externalId: number): number | null {
  if (externalId < 900101 || externalId > AI_PHYSICS_MAX_EXTERNAL_ID) return null
  const normalized = String(externalId)
  const sectionDigit = Number(normalized[3])
  return Number.isInteger(sectionDigit) && sectionDigit >= 1 && sectionDigit <= 7 ? sectionDigit : null
}

function buildVirtualPhysicsSections(topics: CatalogTopic[], taskCountByTopic: Record<string, number>, doneByTopic: Record<string, number>): CatalogTopic[] {
  const topicsBySection = new Map<number, CatalogTopic[]>()
  for (const topic of topics) {
    const sectionNumber = getPhysicsSectionNumber(topic.external_id)
    if (!sectionNumber) continue
    const bucket = topicsBySection.get(sectionNumber) ?? []
    bucket.push({
      ...topic,
      task_count: taskCountByTopic[topic.id] ?? 0,
      completed_count: doneByTopic[topic.id] ?? 0,
    })
    topicsBySection.set(sectionNumber, bucket)
  }

  return Object.entries(AI_PHYSICS_SECTION_META).map(([sectionNumberRaw, title]) => {
    const sectionNumber = Number(sectionNumberRaw)
    const children = (topicsBySection.get(sectionNumber) ?? []).sort((a, b) => a.position - b.position || a.external_id - b.external_id)
    return {
      id: `physics-topics-section-${sectionNumber}`,
      external_id: 900000 + sectionNumber,
      parent_id: null,
      title,
      slug: `physics-topics-section-${sectionNumber}`,
      position: sectionNumber,
      task_count: children.reduce((sum, topic) => sum + (topic.task_count ?? 0), 0),
      completed_count: children.reduce((sum, topic) => sum + (topic.completed_count ?? 0), 0),
      children,
    }
  })
}

function buildVirtualPhysicsSectionsFromCatalog(taskCountByTopic: Record<string, number>, doneByTopic: Record<string, number>): CatalogTopic[] {
  return buildVirtualPhysicsSections(
    physicsTopicsCatalog.map(topic => ({
      ...topic,
      parent_id: null,
      slug: null,
      position: topic.external_id,
    })),
    taskCountByTopic,
    doneByTopic,
  )
}

async function fetchAllPagedRows<T>(buildQuery: (from: number, to: number) => Promise<{ data: T[] | null; error: { message?: string } | null }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += SELECT_PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + SELECT_PAGE_SIZE - 1)
    if (error) throw new Error(error.message ?? 'Не удалось загрузить каталог')
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < SELECT_PAGE_SIZE) break
  }
  return rows
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

async function fetchPhysicsTopicCounts(): Promise<Record<string, { task_count: number; completed_count: number }>> {
  const { data, error } = await db.rpc('get_catalog_topic_counts_by_source', {
    p_subject: 'Физика',
    p_exam_type: 'ЕГЭ',
    p_source: AI_PHYSICS_SOURCE,
  })
  if (error) throw new Error(error.message ?? 'Не удалось загрузить каталог')

  const counts: Record<string, { task_count: number; completed_count: number }> = {}
  for (const row of (data ?? []) as Array<{ topic_id: string; task_count: number; completed_count: number }>) {
    counts[row.topic_id] = { task_count: row.task_count, completed_count: row.completed_count }
  }
  return counts
}

async function fetchPhysicsSectionCounts(): Promise<{
  bySectionId: Record<string, { task_count: number; completed_count: number }>
  totalTaskCount: number
  totalCompletedCount: number
}> {
  const { data, error } = await db.rpc('get_catalog_section_task_counts_by_source', {
    p_subject: 'Физика',
    p_exam_type: 'ЕГЭ',
    p_source: AI_PHYSICS_SOURCE,
  })
  if (error) throw new Error(error.message ?? 'Не удалось загрузить каталог')

  const bySectionId: Record<string, { task_count: number; completed_count: number }> = {}
  let totalTaskCount = 0
  let totalCompletedCount = 0

  for (const row of (data ?? []) as Array<{
    section_id: string | null
    task_count: number
    completed_count: number
  }>) {
    if (row.section_id === null) {
      totalTaskCount = row.task_count ?? 0
      totalCompletedCount = row.completed_count ?? 0
      continue
    }
    bySectionId[row.section_id] = {
      task_count: row.task_count ?? 0,
      completed_count: row.completed_count ?? 0,
    }
  }

  return { bySectionId, totalTaskCount, totalCompletedCount }
}

/**
 * Задачи темы.
 *
 * `primaryOnly` нужен вкладке «Физические темы»: счётчики там считаются по
 * основной теме задачи (RPC ...by_source, миграция
 * 20260802233810_catalog_physics_topic_counts_by_primary_link). У задачи до
 * трёх связей с темами, поэтому без того же фильтра здесь список на странице
 * оказался бы длиннее числа в боковой панели.
 */
async function fetchAllTopicTaskIds(topicId: string, source?: string, primaryOnly = false): Promise<string[]> {
  const rows = await fetchAllPagedRows<{ task_id: string }>((from, to) => {
    let query = db
      .from('catalog_task_topics')
      .select('task_id')
      .eq('topic_id', topicId)
      .order('task_id')
      .range(from, to)
    if (source) query = query.eq('source', source)
    if (primaryOnly) query = query.eq('is_primary', true)
    return query
  })

  return [...new Set(rows.map(row => row.task_id))]
}

async function fetchCompletedTaskIdsForUser(userId: string): Promise<Set<string>> {
  const rows = await fetchAllPagedRows<{ task_id: string }>((from, to) =>
    db
      .from('catalog_task_progress')
      .select('task_id')
      .eq('user_id', userId)
      .eq('is_completed', true)
      .range(from, to)
  )

  return new Set(rows.map(row => row.task_id))
}

async function fetchTasksByIds(taskIds: string[]): Promise<CatalogTask[]> {
  if (taskIds.length === 0) return []

  const rows: CatalogTask[] = []
  for (const batch of chunk(taskIds, IN_FILTER_CHUNK)) {
    const { data, error } = await db
      .from('catalog_tasks')
      .select('id, external_id, section_id, subject, exam_type, difficulty, statement_html, answer_html, solution_html, solution_plan_html, grade_criteria_html, has_answer, has_solution, position, exam_part')
      .in('id', batch)
      .eq('is_published', true)
      .order('position')

    if (error) throw new Error(error.message ?? 'Не удалось загрузить каталог')
    rows.push(...(data ?? []))
  }

  return rows
}

async function fetchCompletedTaskRowsForUserByTaskIds(userId: string, taskIds: string[]): Promise<Array<{ task_id: string; is_completed?: boolean }>> {
  if (taskIds.length === 0) return []

  const rows: Array<{ task_id: string; is_completed?: boolean }> = []
  for (const batch of chunk(taskIds, IN_FILTER_CHUNK)) {
    const { data, error } = await db
      .from('catalog_task_progress')
      .select('task_id, is_completed')
      .in('task_id', batch)
      .eq('user_id', userId)
      .eq('is_completed', true)

    if (error) throw new Error(error.message ?? 'Не удалось загрузить каталог')
    rows.push(...(data ?? []))
  }

  return rows
}

async function loadPhysicsTopicSections(_userId: string): Promise<{
  sections: CatalogTopic[]
  totalTaskCount: number
  totalCompletedCount: number
}> {
  const { data: allTopics, error: topicsError } = await fetchCatalogTopicsWithPublishedFallback(includePublishedFilter => {
    let query = db
      .from('catalog_topics')
      .select('*')
      .eq('subject', 'Физика')
      .eq('exam_type', 'ЕГЭ')
      .gte('external_id', AI_PHYSICS_ROOT_EXTERNAL_ID)
      .lte('external_id', AI_PHYSICS_MAX_EXTERNAL_ID)
      .order('position')
    if (includePublishedFilter) query = query.eq('is_published', true)
    return query
  })
  if (topicsError) throw new Error(topicsError.message ?? 'Не удалось загрузить каталог')

  const topics = (allTopics ?? []) as CatalogTopic[]
  const root = topics.find(topic => topic.external_id === AI_PHYSICS_ROOT_EXTERNAL_ID)
  const sectionTopics = root ? topics.filter(topic => topic.parent_id === root.id) : []
  const fallbackTopics = topics.length > 0
    ? topics
    : physicsTopicsCatalog.map(topic => ({
        ...topic,
        parent_id: null,
        slug: null,
        position: topic.external_id,
      }))
  const leafTopics = sectionTopics.length > 0
    ? topics.filter(topic => topic.parent_id !== null && !sectionTopics.some(section => section.id === topic.id))
    : fallbackTopics.filter(topic => getPhysicsSectionNumber(topic.external_id) !== null)

  if (leafTopics.length === 0) {
    return {
      sections: topics.length > 0
        ? buildVirtualPhysicsSections(topics, {}, {})
        : buildVirtualPhysicsSectionsFromCatalog({}, {}),
      totalTaskCount: 0,
      totalCompletedCount: 0,
    }
  }

  const leafTopicIds = new Set(leafTopics.map(topic => topic.id))
  const sectionCounts = await fetchPhysicsSectionCounts()
  const taskCountByTopic: Record<string, number> = {}
  const doneByTopic: Record<string, number> = {}
  for (const topicId of leafTopicIds) {
    taskCountByTopic[topicId] = 0
    doneByTopic[topicId] = 0
  }

  const sections = sectionTopics.length > 0
    ? sectionTopics.map(section => {
        const children = topics.filter(topic => topic.parent_id === section.id)
        const sectionCount = sectionCounts.bySectionId[section.id] ?? { task_count: 0, completed_count: 0 }
        return {
          ...section,
          task_count: sectionCount.task_count,
          completed_count: sectionCount.completed_count,
          children: children.map(topic => ({
            ...topic,
            task_count: taskCountByTopic[topic.id] ?? 0,
            completed_count: doneByTopic[topic.id] ?? 0,
          })),
        }
      })
    : topics.length > 0
      ? buildVirtualPhysicsSections(topics, taskCountByTopic, doneByTopic).map(section => {
          const sectionCount = sectionCounts.bySectionId[section.id] ?? { task_count: 0, completed_count: 0 }
          return {
            ...section,
            task_count: sectionCount.task_count,
            completed_count: sectionCount.completed_count,
          }
        })
      : buildVirtualPhysicsSectionsFromCatalog(taskCountByTopic, doneByTopic).map(section => {
          const sectionCount = sectionCounts.bySectionId[section.id] ?? { task_count: 0, completed_count: 0 }
          return {
            ...section,
            task_count: sectionCount.task_count,
            completed_count: sectionCount.completed_count,
          }
        })

  return {
    sections,
    totalTaskCount: sectionCounts.totalTaskCount,
    totalCompletedCount: sectionCounts.totalCompletedCount,
  }
}

async function loadPhysicsSectionTopics(sectionId: string, _userId: string): Promise<CatalogTopic[]> {
  const virtualSectionNumber = sectionId.startsWith('physics-topics-section-')
    ? Number(sectionId.replace('physics-topics-section-', ''))
    : null

  const { data: topicsData, error: topicsError } = await fetchCatalogTopicsWithPublishedFallback(includePublishedFilter => {
    let query = db
      .from('catalog_topics')
      .select('*')
      .order('position')
    if (virtualSectionNumber === null) query = query.eq('parent_id', sectionId)
    query = query.eq('subject', 'Физика').eq('exam_type', 'ЕГЭ')
    if (includePublishedFilter) query = query.eq('is_published', true)
    return query
  })
  if (topicsError) throw new Error(topicsError.message ?? 'Не удалось загрузить каталог')

  const typedTopics = (topicsData ?? []) as CatalogTopic[]
  const sourceTopics = typedTopics.length > 0
    ? typedTopics
    : physicsTopicsCatalog.map(topic => ({
        ...topic,
        parent_id: null,
        slug: null,
        position: topic.external_id,
      }))
  const filteredTopics = virtualSectionNumber
    ? sourceTopics.filter(topic => getPhysicsSectionNumber(topic.external_id) === virtualSectionNumber)
    : sourceTopics

  if (filteredTopics.length === 0) return []

  const topicIds = new Set(filteredTopics.map(topic => topic.id))
  const counts = await fetchPhysicsTopicCounts()
  const taskCountByTopic: Record<string, number> = {}
  const doneByTopic: Record<string, number> = {}
  for (const topicId of topicIds) {
    taskCountByTopic[topicId] = counts[topicId]?.task_count ?? 0
    doneByTopic[topicId] = counts[topicId]?.completed_count ?? 0
  }

  return filteredTopics.map(topic => ({
    ...topic,
    task_count: taskCountByTopic[topic.id] ?? 0,
    completed_count: doneByTopic[topic.id] ?? 0,
  }))
}

async function loadPhysicsTopicTasks(topicId: string, userId: string): Promise<{
  tasks: CatalogTask[]
  completedIds: Set<string>
}> {
  const taskIds = await fetchAllTopicTaskIds(topicId, AI_PHYSICS_SOURCE, true)
  if (!taskIds.length) return { tasks: [], completedIds: new Set() }

  const tasksData = await fetchTasksByIds(taskIds)
  const completedIds = await fetchCompletedTaskIdsForUser(userId)

  const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
  const ASSET_PAGE = 1000
  const ASSET_CHUNK = 50
  for (let ci = 0; ci < taskIds.length; ci += ASSET_CHUNK) {
    const chunk = taskIds.slice(ci, ci + ASSET_CHUNK)
    for (let from = 0; ; from += ASSET_PAGE) {
      const { data: assetPage, error: assetsError } = await db
        .from('catalog_task_assets')
        .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
        .in('task_id', chunk)
        .order('position')
        .range(from, from + ASSET_PAGE - 1)
      if (assetsError) throw new Error(assetsError.message ?? 'Не удалось загрузить каталог')
      if (!assetPage || assetPage.length === 0) break
      allAssets.push(...(assetPage as (CatalogTaskAsset & { task_id: string })[]))
      if (assetPage.length < ASSET_PAGE) break
    }
  }

  const assetsByTask: Record<string, CatalogTaskAsset[]> = {}
  for (const asset of allAssets) {
    const assetTaskId = asset.task_id
    if (!assetsByTask[assetTaskId]) assetsByTask[assetTaskId] = []
    assetsByTask[assetTaskId].push(asset)
  }

  const enrichedTasks = tasksData.map((task: CatalogTask) => ({
    ...task,
    difficulty: task.difficulty ?? null,
    assets: assetsByTask[task.id] ?? [],
    is_completed: completedIds.has(task.id),
  }))

  const sortedTasks = [...enrichedTasks].sort((a, b) =>
    getPhysicsDifficultyOrder(a.difficulty) - getPhysicsDifficultyOrder(b.difficulty)
    || a.position - b.position
    || a.external_id - b.external_id
  )

  return { tasks: sortedTasks, completedIds }
}

/**
 * Safely decode a storage path that may already contain URL-encoded characters.
 * The importer stores paths with encoded chars (e.g. "65186%20-%201.png").
 * getPublicUrl would double-encode them (%20→%2520), producing broken URLs.
 * Decoding first lets Supabase re-encode correctly to a single %20.
 *
 * Cyrillic filenames use 'x' as escape prefix (xD0x9F…) — those are pure ASCII
 * and pass through unchanged since 'x' is not a percent-encoded character.
 *
 * Falls back to the original path on malformed sequences (e.g. lone %) so a
 * bad DB record never crashes the page.
 */
export function safeDecodeStoragePath(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/**
 * Base URL for catalog assets served from external storage (Cloudflare R2).
 * When set (e.g. "https://assets.alminion.ru"), asset URLs are built as
 * `${base}/${path}` with per-segment percent-encoding. When empty, falls back
 * to Supabase Storage public URLs (legacy behaviour, incl. the /render/image
 * workaround for PNGs imported with a wrong Content-Type).
 */
const ASSETS_BASE_URL: string = (import.meta.env.VITE_ASSETS_BASE_URL ?? '').replace(/\/+$/, '')

export function getAssetUrl(storagePath: string): string {
  const decoded = safeDecodeStoragePath(storagePath)
  if (ASSETS_BASE_URL) {
    // Object keys in R2 are stored decoded ("1 (1).png"); encode each path
    // segment so spaces/parentheses/Cyrillic survive as a valid URL.
    const encoded = decoded.split('/').map(encodeURIComponent).join('/')
    return `${ASSETS_BASE_URL}/${encoded}`
  }
  // PNG/JPEG files were imported with Content-Type: image/svg+xml (wrong).
  // The /render/image/ endpoint reads actual bytes and serves the correct MIME type.
  const lower = decoded.toLowerCase()
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(decoded, { transform: { quality: 100 } })
    return data.publicUrl
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(decoded)
  return data.publicUrl
}

// ── Sections ──────────────────────────────────────────────────────────────────

/**
 * Разделы каталога с числом задач и личным прогрессом.
 *
 * Три источника независимы (список разделов, счётчики задач, прогресс), но
 * раньше запрашивались строго друг за другом через await — три круговые
 * задержки вместо одной. Теперь Promise.all, и всё завёрнуто в react-query:
 * возврат в тот же раздел не перезапрашивает ничего.
 */
async function loadCatalogSections(
  userId: string,
  subject?: string,
  examType?: string,
): Promise<CatalogSection[]> {
  const sectionsQuery = (() => {
    let q = db.from('catalog_sections').select('*').eq('is_published', true)
    if (subject)  q = q.eq('subject', subject)
    if (examType) q = q.eq('exam_type', examType)
    return q.order('position')
  })()

  const [sectionsRes, countsRes, progressRows] = await Promise.all([
    sectionsQuery,
    db.rpc('get_catalog_section_counts', {
      p_subject:   subject   ?? null,
      p_exam_type: examType  ?? null,
    }),
    fetchAllPagedRows<{ task_id: string; catalog_tasks?: { section_id?: string } }>((from, to) =>
      db
        .from('catalog_task_progress')
        .select('task_id, catalog_tasks!inner(section_id)')
        .eq('user_id', userId)
        .eq('is_completed', true)
        .range(from, to)
    ),
  ])

  if (sectionsRes.error) throw new Error(sectionsRes.error.message ?? 'Не удалось загрузить каталог')
  if (countsRes.error)   throw new Error(countsRes.error.message ?? 'Не удалось загрузить каталог')

  const countBySec: Record<string, number> = {}
  const part1BySec: Record<string, number> = {}
  const part2BySec: Record<string, number> = {}
  for (const row of (countsRes.data ?? []) as {
    section_id: string
    task_count: number
    part1_count?: number | null
    part2_count?: number | null
  }[]) {
    countBySec[row.section_id] = row.task_count
    part1BySec[row.section_id] = row.part1_count ?? 0
    part2BySec[row.section_id] = row.part2_count ?? 0
  }

  const doneBySec: Record<string, number> = {}
  for (const p of progressRows) {
    const secId = p.catalog_tasks?.section_id
    if (secId) doneBySec[secId] = (doneBySec[secId] ?? 0) + 1
  }

  return ((sectionsRes.data ?? []) as CatalogSection[]).map(s => ({
    ...s,
    task_count:      countBySec[s.id] ?? 0,
    part1_count:     part1BySec[s.id] ?? 0,
    part2_count:     part2BySec[s.id] ?? 0,
    completed_count: doneBySec[s.id]  ?? 0,
  }))
}

export function useCatalogSections(subject?: string, examType?: string, _retryKey?: number) {
  const { profile } = useAuthStore()
  const query = useQuery({
    queryKey: ['catalog-sections', profile?.id ?? 'anon', subject ?? 'all', examType ?? 'all', _retryKey ?? 0] as const,
    enabled: Boolean(profile?.id),
    staleTime: CATALOG_STRUCTURE_CACHE_MS,
    gcTime: CATALOG_STRUCTURE_CACHE_MS * 6,
    queryFn: () => loadCatalogSections(profile!.id, subject, examType),
  })

  return {
    sections: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : query.error ? 'Не удалось загрузить каталог' : null,
  }
}

export function useCatalogPhysicsTopicSections(enabled: boolean, _retryKey?: number) {
  const { profile } = useAuthStore()
  const queryKey = getCatalogPhysicsQueryKeys(profile?.id, _retryKey)
  const query = useQuery({
    queryKey: queryKey.sections,
    enabled: Boolean(profile?.id && enabled),
    staleTime: PHYSICS_TOPICS_CACHE_MS,
    gcTime: PHYSICS_TOPICS_CACHE_MS * 6,
    queryFn: () => loadPhysicsTopicSections(profile!.id),
  })

  return {
    sections: enabled ? (query.data?.sections ?? []) : [],
    totalTaskCount: enabled ? (query.data?.totalTaskCount ?? 0) : 0,
    totalCompletedCount: enabled ? (query.data?.totalCompletedCount ?? 0) : 0,
    loading: enabled ? query.isLoading : false,
    error: enabled ? (query.error instanceof Error ? query.error.message : query.error ? 'Не удалось загрузить каталог' : null) : null,
  }
}

// ── Topics for a section ──────────────────────────────────────────────────────

export function useCatalogTopics(
  sectionId: string | undefined,
  _retryKey?: number,
  view: CatalogViewMode = 'exam',
  subject?: string,
  examType?: string,
) {
  const { profile } = useAuthStore()
  const isPhysicsTopicsView = view === 'physics-topics' && subject === 'Физика' && examType === 'ЕГЭ'
  const queryKey = getCatalogPhysicsQueryKeys(profile?.id, _retryKey, sectionId)

  const physicsTopicsQuery = useQuery({
    queryKey: queryKey.sectionTopics,
    enabled: Boolean(profile?.id && sectionId && isPhysicsTopicsView),
    staleTime: PHYSICS_TOPICS_CACHE_MS,
    gcTime: PHYSICS_TOPICS_CACHE_MS * 6,
    queryFn: () => loadPhysicsSectionTopics(sectionId!, profile!.id),
  })

  // Обычный (экзаменационный) вид: один запрос вместо ~32 последовательных,
  // и через react-query — возврат в уже открытый раздел берётся из кэша,
  // а не перезапрашивается заново. Прогресс входит в ту же RPC, поэтому
  // ключ кэша обязан включать пользователя.
  const examTopicsQuery = useQuery({
    queryKey: ['catalog-section-topic-tree', profile?.id ?? 'anon', sectionId ?? 'none', _retryKey ?? 0] as const,
    enabled: Boolean(profile?.id && sectionId && !isPhysicsTopicsView),
    staleTime: CATALOG_STRUCTURE_CACHE_MS,
    gcTime: CATALOG_STRUCTURE_CACHE_MS * 6,
    queryFn: () => loadSectionTopicTree(sectionId!),
  })

  if (isPhysicsTopicsView) {
    return {
      topics: physicsTopicsQuery.data ?? [],
      loading: physicsTopicsQuery.isLoading,
      error: physicsTopicsQuery.error instanceof Error ? physicsTopicsQuery.error.message : physicsTopicsQuery.error ? 'Не удалось загрузить каталог' : null,
    }
  }

  return {
    topics: examTopicsQuery.data ?? [],
    loading: examTopicsQuery.isLoading,
    error: examTopicsQuery.error instanceof Error ? examTopicsQuery.error.message : examTopicsQuery.error ? 'Не удалось загрузить каталог' : null,
  }
}

// ── Direction task counts (for landing picker) ────────────────────────────────

/**
 * Четыре карточки лендинга каталога.
 *
 * taskCount ЗАФИКСИРОВАН в коде намеренно (решение владельца 2026-07-30:
 * «сделай это просто фиксированными числами, чтобы они не подгружались откуда
 * либо»). Раньше числа тянулись RPC get_catalog_direction_counts, и лендинг
 * ждал ответа: замер на проде до оптимизации — 2645 мс на один запрос
 * (полный проход по catalog_tasks с широкими строками контента). Индекс
 * catalog_tasks_counts_covering_idx (миграция 20260730_catalog_counts_covering_index)
 * сбил это до ~10 мс, но лендингу и этого ждать незачем: числа показываются
 * округлёнными («9.5 тыс.»), меняются только при заливке новых задач в
 * каталог и ни на что в логике не влияют.
 *
 * КАК ОБНОВИТЬ после пополнения каталога:
 *   select * from get_catalog_direction_counts();
 * и вписать сюда. Округление до десятых долей тысячи (numFmt в CatalogPage)
 * скрывает расхождение примерно до ±50 задач, так что точность здесь
 * заведомо избыточна.
 *
 * Снято 2026-07-30: math_ege 9515, math_oge 5972, physics_ege 3386, physics_oge 2910.
 */
export const DIRECTIONS = [
  { key: 'math-ege',    subject: 'Математика', examType: 'ЕГЭ', subjectSlug: 'math',    examSlug: 'ege',
    label: 'Математика ЕГЭ', desc: 'Профильная математика, задания №1–19', taskCount: 9515 },
  { key: 'math-oge',    subject: 'Математика', examType: 'ОГЭ', subjectSlug: 'math',    examSlug: 'oge',
    label: 'Математика ОГЭ', desc: 'Подготовка к экзамену за 9 класс', taskCount: 5972 },
  { key: 'physics-ege', subject: 'Физика',     examType: 'ЕГЭ', subjectSlug: 'physics', examSlug: 'ege',
    label: 'Физика ЕГЭ',     desc: 'Задачи первой и второй части', taskCount: 3386 },
  { key: 'physics-oge', subject: 'Физика',     examType: 'ОГЭ', subjectSlug: 'physics', examSlug: 'oge',
    label: 'Физика ОГЭ',     desc: 'Задания по всем разделам экзамена', taskCount: 2910 },
] as const

export type DirectionKey = typeof DIRECTIONS[number]['key']

// Счётчики направлений больше не читаются из базы: числа зафиксированы в
// DIRECTIONS выше (см. комментарий там). Хук useCatalogDirectionCounts и тип
// DirectionCountRow удалены как мёртвый код — RPC get_catalog_direction_counts
// в базе оставлена, ей теперь пользуются только для обновления констант.

// ── Single task by id ────────────────────────────────────────────────────────

export function useCatalogTask(taskId: string | undefined) {
  const { profile } = useAuthStore()
  const [task, setTask] = useState<(CatalogTask & { section?: CatalogSection; hasTopicAssigned?: boolean }) | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile || !taskId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data: t, error: e1 } = await db
          .from('catalog_tasks')
          .select('id, external_id, section_id, subject, exam_type, difficulty, statement_html, answer_html, solution_html, solution_plan_html, grade_criteria_html, has_answer, has_solution, position, is_published, exam_part')
          .eq('id', taskId)
          .single()
        if (e1 || cancelled) { if (!cancelled) setError(e1?.message ?? 'Задача не найдена'); setLoading(false); return }

        // Section
        const { data: sec, error: sectionError } = await db.from('catalog_sections').select('*').eq('id', t.section_id).single()
        if (sectionError || cancelled) { if (!cancelled) setError(sectionError?.message ?? 'Не удалось загрузить каталог'); setLoading(false); return }

        // Assets
        const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
        for (let from = 0; ; from += 1000) {
          const { data: page, error: assetsError } = await db
            .from('catalog_task_assets')
            .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
            .eq('task_id', taskId)
            .order('position')
            .range(from, from + 999)
          if (assetsError || cancelled) { if (!cancelled) setError(assetsError?.message ?? 'Не удалось загрузить каталог'); setLoading(false); return }
          if (!page || page.length === 0) break
          allAssets.push(...page)
          if (page.length < 1000) break
        }

        // Does this task have a topic?
        const { data: topicLink, error: topicLinkError } = await db
          .from('catalog_task_topics')
          .select('topic_id')
          .eq('task_id', taskId)
          .limit(1)
        if (topicLinkError || cancelled) { if (!cancelled) setError(topicLinkError?.message ?? 'Не удалось загрузить каталог'); setLoading(false); return }

        if (!cancelled) {
          setTask({ ...t, section: sec ?? undefined, assets: allAssets, hasTopicAssigned: (topicLink ?? []).length > 0 })
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить каталог')
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [profile, taskId])

  return { task, loading, error }
}

// ── Batch-load tasks by explicit ID list (for CollectionDetailPage) ───────────

export function useCatalogTasksBatch(taskIds: string[]) {
  const { profile } = useAuthStore()
  const [tasks,   setTasks]   = useState<(CatalogTask & { assets: CatalogTaskAsset[] })[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Stable key so useEffect only re-runs when the ID list actually changes
  const idsKey = taskIds.join(',')

  useEffect(() => {
    if (!profile || taskIds.length === 0) { setTasks([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      try {
        // Chunk .in() to ≤50 UUIDs to avoid URL truncation
        const CHUNK = 50
        const allTasks: CatalogTask[] = []
        for (let i = 0; i < taskIds.length; i += CHUNK) {
          const { data, error: e } = await db
            .from('catalog_tasks')
            .select('id, external_id, section_id, subject, exam_type, statement_html, answer_html, solution_html, solution_plan_html, grade_criteria_html, source_url, has_answer, has_solution, position, exam_part')
            .in('id', taskIds.slice(i, i + CHUNK))
            .eq('is_published', true)
          if (e || cancelled) { if (!cancelled) setError(e?.message ?? 'Не удалось загрузить каталог'); setLoading(false); return }
          allTasks.push(...(data ?? []))
        }

        // Batch-load all assets
        const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
        const PAGE = 1000
        for (let i = 0; i < taskIds.length; i += CHUNK) {
          for (let from = 0; ; from += PAGE) {
            const { data: page, error: assetsError } = await db
              .from('catalog_task_assets')
              .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
              .in('task_id', taskIds.slice(i, i + CHUNK))
              .order('position')
              .range(from, from + PAGE - 1)
            if (assetsError || cancelled) { if (!cancelled) setError(assetsError?.message ?? 'Не удалось загрузить каталог'); setLoading(false); return }
            if (!page || page.length === 0) break
            allAssets.push(...(page as (CatalogTaskAsset & { task_id: string })[]))
            if (page.length < PAGE) break
          }
        }

        if (cancelled) return

        const assetsByTask: Record<string, CatalogTaskAsset[]> = {}
        for (const a of allAssets) {
          const tid = (a as CatalogTaskAsset & { task_id: string }).task_id
          if (!assetsByTask[tid]) assetsByTask[tid] = []
          assetsByTask[tid].push(a)
        }

        // Batch-load sections referenced by these tasks (for codifier section titles)
        const sectionIds = [...new Set(allTasks.map(t => t.section_id).filter(Boolean))]
        const sectionsById: Record<string, CatalogSection> = {}
        for (let i = 0; i < sectionIds.length; i += CHUNK) {
          const { data: secs, error: sectionsError } = await db
            .from('catalog_sections')
            .select('id, external_id, subject, exam_type, exam_number, title, position')
            .in('id', sectionIds.slice(i, i + CHUNK))
          if (sectionsError || cancelled) { if (!cancelled) setError(sectionsError?.message ?? 'Не удалось загрузить каталог'); setLoading(false); return }
          for (const s of secs ?? []) sectionsById[s.id] = s
        }

        if (cancelled) return

        // Preserve the original taskIds order
        const taskMap = new Map(allTasks.map(t => [t.id, t]))
        setTasks(
          taskIds
            .map(id => taskMap.get(id))
            .filter((t): t is CatalogTask => !!t)
            .map(t => ({
              ...t,
              assets: assetsByTask[t.id] ?? [],
              section: sectionsById[t.section_id],
              sectionTitle: sectionsById[t.section_id]?.title ?? null,
            }))
        )
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить каталог')
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, idsKey])

  return { tasks, loading, error }
}

// ── Search tasks in a section (includes unassigned tasks) ─────────────────────

export interface CatalogSearchResult extends CatalogTask {
  hasTopicAssigned?: boolean
}

export function useCatalogSearch(query: string, sectionId: string | undefined, enabled = true) {
  const { profile } = useAuthStore()
  const [results, setResults] = useState<CatalogSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (!enabled || !profile || !sectionId || q.length < 2) { setResults([]); setLoading(false); setError(null); return }
    let cancelled = false

    async function search() {
      setLoading(true)
      setError(null)
      try {
        // Numeric query → search by external_id first
        const isNum = /^\d+$/.test(q)
        let data: Array<Pick<CatalogTask, 'id' | 'external_id' | 'section_id'>> | null = null
        let err = null

        if (isNum) {
          const res = await db
            .from('catalog_tasks')
            .select('id, external_id, section_id')
            .eq('section_id', sectionId)
            .eq('external_id', parseInt(q, 10))
            .eq('is_published', true)
            .limit(20)
          data = res.data; err = res.error
        }

        // Text search (ilike on plain-text rendering not possible without RPC — use HTML)
        if (!isNum || !data?.length) {
          const res = await db
            .from('catalog_tasks')
            .select('id, external_id, section_id')
            .eq('section_id', sectionId)
            .eq('is_published', true)
            .ilike('statement_html', `%${q}%`)
            .order('position')
            .limit(50)
          if (!err) { data = res.data; err = res.error }
        }

        if (err || cancelled) { if (!cancelled) setError(err?.message ?? 'Не удалось загрузить каталог'); setLoading(false); return }

        const rows = data ?? []
        const taskIds = rows.map(row => row.id)
        const tasksData = await fetchTasksByIds(taskIds)
        if (cancelled) return

        const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
        const ASSET_PAGE = 1000
        const ASSET_CHUNK = 50
        for (let ci = 0; ci < taskIds.length; ci += ASSET_CHUNK) {
          const chunk = taskIds.slice(ci, ci + ASSET_CHUNK)
          for (let from = 0; ; from += ASSET_PAGE) {
            const { data: assetPage, error: assetsError } = await db
              .from('catalog_task_assets')
              .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
              .in('task_id', chunk)
              .order('position')
              .range(from, from + ASSET_PAGE - 1)
            if (assetsError || cancelled) { if (!cancelled) setError(assetsError?.message ?? 'Не удалось загрузить каталог'); setLoading(false); return }
            if (!assetPage || assetPage.length === 0) break
            allAssets.push(...(assetPage as (CatalogTaskAsset & { task_id: string })[]))
            if (assetPage.length < ASSET_PAGE) break
          }
        }

        const assetsByTask: Record<string, CatalogTaskAsset[]> = {}
        for (const asset of allAssets) {
          if (!assetsByTask[asset.task_id]) assetsByTask[asset.task_id] = []
          assetsByTask[asset.task_id].push(asset)
        }

        // Check which tasks have a topic (for admin marker)
        const linkedSet = new Set<string>()
        for (let i = 0; i < taskIds.length; i += 50) {
          const { data: links, error: linksError } = await db
            .from('catalog_task_topics')
            .select('task_id')
            .in('task_id', taskIds.slice(i, i + 50))
          if (linksError || cancelled) { if (!cancelled) setError(linksError?.message ?? 'Не удалось загрузить каталог'); setLoading(false); return }
          for (const l of links ?? []) linkedSet.add(l.task_id)
        }

        if (!cancelled) {
          const taskMap = new Map(tasksData.map(task => [task.id, task]))
          setResults(
            taskIds
              .map(id => taskMap.get(id))
              .filter((task): task is CatalogTask => !!task)
              .map(task => ({
                ...task,
                assets: assetsByTask[task.id] ?? [],
                hasTopicAssigned: linkedSet.has(task.id),
              }))
          )
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить каталог')
          setLoading(false)
        }
      }
    }

    const timer = setTimeout(search, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [enabled, profile, query, sectionId])

  return { results, loading, error }
}

// ── Tasks for a topic ─────────────────────────────────────────────────────────

export function useCatalogTasks(topicId: string | undefined, _retryKey?: number, view: CatalogViewMode = 'exam') {
  const { profile } = useAuthStore()
  const queryKey = getCatalogPhysicsQueryKeys(profile?.id, _retryKey, undefined, topicId)
  const physicsTasksQuery = useQuery({
    queryKey: queryKey.topicTasks,
    enabled: Boolean(profile?.id && topicId && view === 'physics-topics'),
    staleTime: PHYSICS_TOPICS_CACHE_MS,
    gcTime: PHYSICS_TOPICS_CACHE_MS * 6,
    queryFn: () => loadPhysicsTopicTasks(topicId!, profile!.id),
  })
  const [tasks, setTasks] = useState<CatalogTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!profile || !topicId) return
    if (view === 'physics-topics') return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        // Paginated fetch — guard against topics that could exceed 1000 tasks
        const taskIds = await fetchAllTopicTaskIds(topicId!, view === 'physics-topics' ? AI_PHYSICS_SOURCE : undefined)
        if (!taskIds.length) { if (!cancelled) { setTasks([]); setLoading(false) } return }

        const tasksData = await fetchTasksByIds(taskIds)
        if (cancelled) return

        // Assets: chunk .in() ≤50 UUIDs to avoid URL truncation, paginate rows
        const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
        const ASSET_PAGE  = 1000
        const ASSET_CHUNK = 50
        for (let ci = 0; ci < taskIds.length; ci += ASSET_CHUNK) {
          const chunk = taskIds.slice(ci, ci + ASSET_CHUNK)
          for (let from = 0; ; from += ASSET_PAGE) {
            const { data: assetPage, error: assetsError } = await db
              .from('catalog_task_assets')
              .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
              .in('task_id', chunk)
              .order('position')
              .range(from, from + ASSET_PAGE - 1)
            if (assetsError || cancelled) { if (!cancelled) { setError(assetsError?.message ?? 'Не удалось загрузить каталог'); setLoading(false) } return }
            if (!assetPage || assetPage.length === 0) break
            allAssets.push(...(assetPage as (CatalogTaskAsset & { task_id: string })[]))
            if (assetPage.length < ASSET_PAGE) break
          }
        }
        const assetsData = allAssets

        const progressData = await fetchCompletedTaskRowsForUserByTaskIds(profile!.id, taskIds)
        if (cancelled) return

        const assetsByTask: Record<string, CatalogTaskAsset[]> = {}
        for (const a of assetsData ?? []) {
          const aid = (a as CatalogTaskAsset & { task_id: string }).task_id
          if (!assetsByTask[aid]) assetsByTask[aid] = []
          assetsByTask[aid].push(a as CatalogTaskAsset)
        }

        const done = new Set<string>(progressData.map((p: { task_id: string }) => p.task_id))
        setCompletedIds(done)
        const enrichedTasks = tasksData.map((t: CatalogTask) => ({
          ...t,
          difficulty: t.difficulty ?? null,
          assets:       assetsByTask[t.id] ?? [],
          is_completed: done.has(t.id),
        }))

        const sortedTasks = view === 'physics-topics'
          ? [...enrichedTasks].sort((a, b) =>
              getPhysicsDifficultyOrder(a.difficulty) - getPhysicsDifficultyOrder(b.difficulty)
              || a.position - b.position
              || a.external_id - b.external_id
            )
          : enrichedTasks

        setTasks(sortedTasks)
        setLoading(false)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить каталог')
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [profile, topicId, _retryKey, view])

  useEffect(() => {
    if (view !== 'physics-topics') return
    setCompletedIds(physicsTasksQuery.data?.completedIds ?? new Set())
  }, [view, physicsTasksQuery.data])

  // Toggle completion
  const toggleComplete = useCallback(async (taskId: string, currentlyDone: boolean) => {
    if (!profile) return

    if (currentlyDone) {
      await db
        .from('catalog_task_progress')
        .delete()
        .eq('user_id', profile.id)
        .eq('task_id', taskId)
    } else {
      await db
        .from('catalog_task_progress')
        .upsert({ user_id: profile.id, task_id: taskId, is_completed: true, completed_at: new Date().toISOString() })
    }

    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, is_completed: !currentlyDone } : t
    ))
    setCompletedIds(prev => {
      const next = new Set(prev)
      if (currentlyDone) next.delete(taskId); else next.add(taskId)
      return next
    })
  }, [profile])

  if (view === 'physics-topics') {
    return {
      tasks: physicsTasksQuery.data?.tasks ?? [],
      loading: physicsTasksQuery.isLoading,
      error: physicsTasksQuery.error instanceof Error ? physicsTasksQuery.error.message : physicsTasksQuery.error ? 'Не удалось загрузить каталог' : null,
      completedIds,
      toggleComplete,
    }
  }

  return { tasks, loading, error, completedIds, toggleComplete }
}

async function loadCatalogTaskTopicLinks(taskId: string): Promise<CatalogTaskTopicLink[]> {
  const { data, error } = await db
    .from('catalog_task_topics')
    .select('task_id, topic_id, is_primary, source, catalog_topics(id, external_id, title)')
    .eq('task_id', taskId)
    .eq('source', AI_PHYSICS_SOURCE)
    .order('is_primary', { ascending: false })

  if (error) throw new Error(error.message ?? 'Не удалось загрузить темы задачи')

  return ((data ?? []) as Array<{
    task_id: string
    topic_id: string
    is_primary: boolean
    source: string | null
    catalog_topics?: { id: string; external_id: number; title: string } | null
  }>).map(row => ({
    task_id: row.task_id,
    topic_id: row.topic_id,
    is_primary: row.is_primary,
    source: row.source,
    topic: row.catalog_topics ?? null,
  }))
}

function ensureAffectedRowsCount(count: number, fallbackMessage = 'Не удалось (недостаточно прав)') {
  if (count <= 0) throw new Error(fallbackMessage)
}

export function useCatalogPhysicsTaskTopicEditor(taskId: string | undefined, topicId?: string, sectionId?: string, retryKey?: number) {
  const { profile } = useAuthStore()
  const queryClient = useQueryClient()
  const canEdit = profile?.role === 'admin' || profile?.role === 'owner'
  const editorTopics = physicsTopicsCatalog
    .map(topic => ({
      ...topic,
      sectionTitle: getPhysicsEditorSectionTitle(topic.external_id),
    }))
    .sort((a, b) => a.external_id - b.external_id)
  const linksQuery = useQuery({
    queryKey: ['catalog-physics-task-topic-links', taskId ?? 'none'],
    enabled: Boolean(canEdit && taskId),
    staleTime: 30_000,
    gcTime: PHYSICS_TOPICS_CACHE_MS,
    queryFn: () => loadCatalogTaskTopicLinks(taskId!),
  })

  const invalidateCatalog = useCallback(async () => {
    const keys = getCatalogPhysicsQueryKeys(profile?.id, retryKey, sectionId, topicId)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['catalog-physics-task-topic-links', taskId ?? 'none'] }),
      queryClient.invalidateQueries({ queryKey: ['catalog-physics-topic-sections', profile?.id ?? 'anon'] }),
      queryClient.invalidateQueries({ queryKey: ['catalog-physics-section-topics', profile?.id ?? 'anon'] }),
      queryClient.invalidateQueries({ queryKey: ['catalog-physics-topic-tasks', profile?.id ?? 'anon'] }),
      queryClient.invalidateQueries({ queryKey: keys.sections }),
      queryClient.invalidateQueries({ queryKey: keys.sectionTopics }),
      queryClient.invalidateQueries({ queryKey: keys.topicTasks }),
    ])
  }, [profile?.id, queryClient, retryKey, sectionId, taskId, topicId])

  const addTopic = useCallback(async (nextTopicId: string) => {
    if (!taskId) throw new Error('Задача не найдена')
    const links = linksQuery.data ?? []
    if (links.some(link => link.topic_id === nextTopicId)) throw new Error('Эта тема уже назначена задаче')
    if (links.length >= 3) throw new Error('Можно назначить не более 3 тем')

    const { data, error } = await db
      .from('catalog_task_topics')
      .insert({ task_id: taskId, topic_id: nextTopicId, is_primary: false, source: AI_PHYSICS_SOURCE })
      .select('topic_id')

    if (error) throw new Error(error.message ?? 'Не удалось добавить тему')
    ensureAffectedRowsCount((data ?? []).length)
    await invalidateCatalog()
  }, [invalidateCatalog, linksQuery.data, taskId])

  const replacePrimary = useCallback(async (nextTopicId: string) => {
    if (!taskId) throw new Error('Задача не найдена')
    const links = linksQuery.data ?? []
    const currentPrimary = links.find(link => link.is_primary) ?? null
    if (currentPrimary?.topic_id === nextTopicId) return
    const existingTarget = links.find(link => link.topic_id === nextTopicId) ?? null
    if (!existingTarget && links.length >= 3) throw new Error('Чтобы сменить primary на новую тему, сначала уберите одну из текущих')

    if (currentPrimary) {
      const { data: demotedRows, error: demoteError } = await db
        .from('catalog_task_topics')
        .update({ is_primary: false })
        .eq('task_id', taskId)
        .eq('topic_id', currentPrimary.topic_id)
        .eq('source', AI_PHYSICS_SOURCE)
        .select('topic_id')

      if (demoteError) throw new Error(demoteError.message ?? 'Не удалось сменить primary')
      ensureAffectedRowsCount((demotedRows ?? []).length)
    }

    if (existingTarget) {
      const { data: promotedRows, error: promoteError } = await db
        .from('catalog_task_topics')
        .update({ is_primary: true })
        .eq('task_id', taskId)
        .eq('topic_id', nextTopicId)
        .eq('source', AI_PHYSICS_SOURCE)
        .select('topic_id')

      if (promoteError) throw new Error(promoteError.message ?? 'Не удалось сменить primary')
      ensureAffectedRowsCount((promotedRows ?? []).length)
    } else {
      const { data: insertedRows, error: insertError } = await db
        .from('catalog_task_topics')
        .insert({ task_id: taskId, topic_id: nextTopicId, is_primary: true, source: AI_PHYSICS_SOURCE })
        .select('topic_id')

      if (insertError) throw new Error(insertError.message ?? 'Не удалось сменить primary')
      ensureAffectedRowsCount((insertedRows ?? []).length)
    }

    await invalidateCatalog()
  }, [invalidateCatalog, linksQuery.data, taskId])

  const removeTopic = useCallback(async (topicToRemoveId: string) => {
    if (!taskId) throw new Error('Задача не найдена')
    const links = linksQuery.data ?? []
    const target = links.find(link => link.topic_id === topicToRemoveId)
    if (!target) throw new Error('Связь уже удалена')

    const remaining = links
      .filter(link => link.topic_id !== topicToRemoveId)
      .sort((a, b) => {
        const aExternal = a.topic?.external_id ?? Number.MAX_SAFE_INTEGER
        const bExternal = b.topic?.external_id ?? Number.MAX_SAFE_INTEGER
        return aExternal - bExternal
      })

    const { data: deletedRows, error: deleteError } = await db
      .from('catalog_task_topics')
      .delete()
      .eq('task_id', taskId)
      .eq('topic_id', topicToRemoveId)
      .eq('source', AI_PHYSICS_SOURCE)
      .select('topic_id')

    if (deleteError) throw new Error(deleteError.message ?? 'Не удалось удалить тему')
    ensureAffectedRowsCount((deletedRows ?? []).length)

    if (target.is_primary && remaining.length > 0) {
      const nextPrimary = remaining[0]
      const { data: promotedRows, error: promoteError } = await db
        .from('catalog_task_topics')
        .update({ is_primary: true })
        .eq('task_id', taskId)
        .eq('topic_id', nextPrimary.topic_id)
        .eq('source', AI_PHYSICS_SOURCE)
        .select('topic_id')

      if (promoteError) throw new Error(promoteError.message ?? 'Не удалось назначить новую primary-тему')
      ensureAffectedRowsCount((promotedRows ?? []).length)
    }

    await invalidateCatalog()
  }, [invalidateCatalog, linksQuery.data, taskId])

  return {
    canEdit,
    topicOptions: editorTopics,
    links: linksQuery.data ?? [],
    loading: linksQuery.isLoading,
    error: linksQuery.error instanceof Error ? linksQuery.error.message : linksQuery.error ? 'Не удалось загрузить темы задачи' : null,
    refresh: linksQuery.refetch,
    addTopic,
    replacePrimary,
    removeTopic,
  }
}
