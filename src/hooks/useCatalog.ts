import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'

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
  statement_html: string
  answer_html: string | null
  solution_html: string | null
  solution_plan_html: string | null
  grade_criteria_html: string | null
  source_url?: string | null
  has_answer: boolean
  has_solution: boolean
  position: number
  assets?: CatalogTaskAsset[]
  is_completed?: boolean
  section?: CatalogSection
}

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

export function getAssetUrl(storagePath: string): string {
  const decoded = safeDecodeStoragePath(storagePath)
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

export function useCatalogSections(subject?: string, examType?: string, _retryKey?: number) {
  const { profile } = useAuthStore()
  const [sections, setSections] = useState<CatalogSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      let q = db.from('catalog_sections').select('*').eq('is_published', true)
      if (subject)   q = q.eq('subject',   subject)
      if (examType)  q = q.eq('exam_type', examType)
      const { data: sectionsData, error: e1 } = await q.order('position')

      if (e1 || cancelled) { if (!cancelled) setError(e1?.message ?? ''); setLoading(false); return }

      // Task counts per section via SQL function (avoids 1000-row default limit)
      const { data: sectionCounts } = await db.rpc('get_catalog_section_counts', {
        p_subject:   subject   ?? null,
        p_exam_type: examType  ?? null,
      })

      // User progress counts
      const { data: progressData } = await db
        .from('catalog_task_progress')
        .select('task_id, catalog_tasks!inner(section_id)')
        .eq('is_completed', true)

      const countBySec: Record<string, number> = {}
      for (const row of (sectionCounts ?? []) as { section_id: string; task_count: number }[]) {
        countBySec[row.section_id] = row.task_count
      }

      const doneBySec: Record<string, number> = {}
      for (const p of progressData ?? []) {
        const secId = (p as { catalog_tasks?: { section_id?: string } }).catalog_tasks?.section_id
        if (secId) doneBySec[secId] = (doneBySec[secId] ?? 0) + 1
      }

      if (!cancelled) {
        setSections(
          (sectionsData ?? []).map((s: CatalogSection) => ({
            ...s,
            task_count:      countBySec[s.id] ?? 0,
            completed_count: doneBySec[s.id]  ?? 0,
          }))
        )
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [profile, subject, examType, _retryKey])

  return { sections, loading, error }
}

// ── Topics for a section ──────────────────────────────────────────────────────

export function useCatalogTopics(sectionId: string | undefined) {
  const { profile } = useAuthStore()
  const [topics, setTopics] = useState<CatalogTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile || !sectionId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      // Get all topics that have tasks in this section
      // Use RPC to avoid 1000-row default limit
      const { data: topicIdRows, error: e1 } = await db
        .rpc('get_catalog_topic_ids', { p_section_id: sectionId })
      if (e1 || cancelled) { if (!cancelled) setError(e1?.message ?? ''); setLoading(false); return }

      const topicIds = (topicIdRows ?? []).map((r: { topic_id: string }) => r.topic_id)
      if (!topicIds.length) { if (!cancelled) { setTopics([]); setLoading(false) } return }

      const { data: topicsData, error: e2 } = await db
        .from('catalog_topics')
        .select('*')
        .in('id', topicIds)
        .eq('is_published', true)
        .order('position')

      if (e2 || cancelled) { if (!cancelled) setError(e2?.message ?? ''); setLoading(false); return }

      // Task counts per topic via RPC
      const { data: topicCountRows } = await db
        .rpc('get_catalog_topic_counts', { p_section_id: sectionId })

      const taskCountByTopic: Record<string, number> = {}
      for (const row of (topicCountRows ?? []) as { topic_id: string; task_count: number }[]) {
        taskCountByTopic[row.topic_id] = row.task_count
      }

      // User completed per topic
      const { data: progressData } = await db
        .from('catalog_task_progress')
        .select('task_id, catalog_tasks!inner(section_id, catalog_task_topics(topic_id))')
        .eq('catalog_tasks.section_id', sectionId)
        .eq('is_completed', true)

      const doneByTopic: Record<string, number> = {}
      for (const p of progressData ?? []) {
        const taskRel = (p as { catalog_tasks?: { catalog_task_topics?: { topic_id: string }[] } }).catalog_tasks
        for (const tt of taskRel?.catalog_task_topics ?? []) {
          if (topicIds.includes(tt.topic_id)) {
            doneByTopic[tt.topic_id] = (doneByTopic[tt.topic_id] ?? 0) + 1
          }
        }
      }

      if (!cancelled) {
        setTopics(
          (topicsData ?? []).map((t: CatalogTopic) => ({
            ...t,
            task_count:      taskCountByTopic[t.id] ?? 0,
            completed_count: doneByTopic[t.id]      ?? 0,
          }))
        )
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [profile, sectionId])

  return { topics, loading, error }
}

// ── Direction task counts (for landing picker) ────────────────────────────────

export const DIRECTIONS = [
  { key: 'math-ege',    subject: 'Математика', examType: 'ЕГЭ', subjectSlug: 'math',    examSlug: 'ege',
    label: 'Математика ЕГЭ', desc: 'Профильная математика, задания №1–19' },
  { key: 'math-oge',    subject: 'Математика', examType: 'ОГЭ', subjectSlug: 'math',    examSlug: 'oge',
    label: 'Математика ОГЭ', desc: 'Подготовка к экзамену за 9 класс' },
  { key: 'physics-ege', subject: 'Физика',     examType: 'ЕГЭ', subjectSlug: 'physics', examSlug: 'ege',
    label: 'Физика ЕГЭ',     desc: 'Задачи первой и второй части' },
  { key: 'physics-oge', subject: 'Физика',     examType: 'ОГЭ', subjectSlug: 'physics', examSlug: 'oge',
    label: 'Физика ОГЭ',     desc: 'Задания по всем разделам экзамена' },
] as const

export type DirectionKey = typeof DIRECTIONS[number]['key']

// Shape returned by get_catalog_direction_counts RPC
interface DirectionCountRow {
  math_ege:    number
  math_oge:    number
  physics_ege: number
  physics_oge: number
}

export function useCatalogDirectionCounts() {
  const { profile } = useAuthStore()
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!profile) return
    let cancelled = false

    async function load() {
      // Single aggregating RPC — one table scan, RLS enforced (SECURITY INVOKER)
      const { data, error } = await db.rpc('get_catalog_direction_counts')
      if (cancelled) return
      if (error || !data || !(data as unknown[]).length) return // cards stay without count
      const row = (data as DirectionCountRow[])[0]
      setCounts({
        'math-ege':    row.math_ege    ?? 0,
        'math-oge':    row.math_oge    ?? 0,
        'physics-ege': row.physics_ege ?? 0,
        'physics-oge': row.physics_oge ?? 0,
      })
    }

    load()
    return () => { cancelled = true }
  }, [profile])

  return { counts }
}

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

      const { data: t, error: e1 } = await db
        .from('catalog_tasks')
        .select('id, external_id, section_id, subject, exam_type, statement_html, answer_html, solution_html, solution_plan_html, grade_criteria_html, has_answer, has_solution, position, is_published')
        .eq('id', taskId)
        .single()
      if (e1 || cancelled) { if (!cancelled) setError(e1?.message ?? 'Задача не найдена'); setLoading(false); return }

      // Section
      const { data: sec } = await db.from('catalog_sections').select('*').eq('id', t.section_id).single()

      // Assets
      const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
      for (let from = 0; ; from += 1000) {
        const { data: page } = await db
          .from('catalog_task_assets')
          .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
          .eq('task_id', taskId)
          .order('position')
          .range(from, from + 999)
        if (!page || page.length === 0) break
        allAssets.push(...page)
        if (page.length < 1000) break
      }

      // Does this task have a topic?
      const { data: topicLink } = await db
        .from('catalog_task_topics')
        .select('topic_id')
        .eq('task_id', taskId)
        .limit(1)

      if (!cancelled) {
        setTask({ ...t, section: sec ?? undefined, assets: allAssets, hasTopicAssigned: (topicLink ?? []).length > 0 })
        setLoading(false)
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
      // Chunk .in() to ≤50 UUIDs to avoid URL truncation
      const CHUNK = 50
      const allTasks: CatalogTask[] = []
      for (let i = 0; i < taskIds.length; i += CHUNK) {
        const { data, error: e } = await db
          .from('catalog_tasks')
          .select('id, external_id, section_id, subject, exam_type, statement_html, answer_html, solution_html, solution_plan_html, grade_criteria_html, source_url, has_answer, has_solution, position')
          .in('id', taskIds.slice(i, i + CHUNK))
          .eq('is_published', true)
        if (e || cancelled) { if (!cancelled) setError(e?.message ?? ''); setLoading(false); return }
        allTasks.push(...(data ?? []))
      }

      // Batch-load all assets
      const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
      const PAGE = 1000
      for (let i = 0; i < taskIds.length; i += CHUNK) {
        for (let from = 0; ; from += PAGE) {
          const { data: page } = await db
            .from('catalog_task_assets')
            .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
            .in('task_id', taskIds.slice(i, i + CHUNK))
            .order('position')
            .range(from, from + PAGE - 1)
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
        const { data: secs } = await db
          .from('catalog_sections')
          .select('id, external_id, subject, exam_type, exam_number, title, position')
          .in('id', sectionIds.slice(i, i + CHUNK))
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
    }

    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, idsKey])

  return { tasks, loading, error }
}

// ── Search tasks in a section (includes unassigned tasks) ─────────────────────

export interface CatalogSearchResult {
  id: string
  external_id: number
  section_id: string
  statement_html: string
  has_answer: boolean
  has_solution: boolean
  hasTopicAssigned?: boolean
}

export function useCatalogSearch(query: string, sectionId: string | undefined) {
  const { profile } = useAuthStore()
  const [results, setResults] = useState<CatalogSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (!profile || !sectionId || q.length < 2) { setResults([]); return }
    let cancelled = false

    async function search() {
      setLoading(true)
      setError(null)

      // Numeric query → search by external_id first
      const isNum = /^\d+$/.test(q)
      let data: CatalogSearchResult[] | null = null
      let err = null

      if (isNum) {
        const res = await db
          .from('catalog_tasks')
          .select('id, external_id, section_id, statement_html, has_answer, has_solution')
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
          .select('id, external_id, section_id, statement_html, has_answer, has_solution')
          .eq('section_id', sectionId)
          .eq('is_published', true)
          .ilike('statement_html', `%${q}%`)
          .order('position')
          .limit(50)
        if (!err) { data = res.data; err = res.error }
      }

      if (err || cancelled) { if (!cancelled) setError(err?.message ?? ''); setLoading(false); return }

      const rows = data ?? []

      // Check which tasks have a topic (for admin marker)
      const ids = rows.map(r => r.id)
      const linkedSet = new Set<string>()
      for (let i = 0; i < ids.length; i += 50) {
        const { data: links } = await db
          .from('catalog_task_topics')
          .select('task_id')
          .in('task_id', ids.slice(i, i + 50))
        for (const l of links ?? []) linkedSet.add(l.task_id)
      }

      if (!cancelled) {
        setResults(rows.map(r => ({ ...r, hasTopicAssigned: linkedSet.has(r.id) })))
        setLoading(false)
      }
    }

    const timer = setTimeout(search, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [profile, query, sectionId])

  return { results, loading, error }
}

// ── Tasks for a topic ─────────────────────────────────────────────────────────

export function useCatalogTasks(topicId: string | undefined) {
  const { profile } = useAuthStore()
  const [tasks, setTasks] = useState<CatalogTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!profile || !topicId) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      // Paginated fetch — guard against topics that could exceed 1000 tasks
      const linkRows: { task_id: string }[] = []
      const LINK_PAGE = 1000
      for (let from = 0; ; from += LINK_PAGE) {
        const { data: page, error: e1 } = await db
          .from('catalog_task_topics')
          .select('task_id')
          .eq('topic_id', topicId)
          .range(from, from + LINK_PAGE - 1)
        if (e1 || cancelled) { if (!cancelled) { setError(e1?.message ?? ''); setLoading(false) } return }
        linkRows.push(...(page ?? []))
        if ((page?.length ?? 0) < LINK_PAGE) break
      }

      const taskIds = linkRows.map((l: { task_id: string }) => l.task_id)
      if (!taskIds.length) { if (!cancelled) { setTasks([]); setLoading(false) } return }

      const { data: tasksData, error: e2 } = await db
        .from('catalog_tasks')
        .select('id, external_id, section_id, subject, exam_type, statement_html, answer_html, solution_html, solution_plan_html, grade_criteria_html, has_answer, has_solution, position')
        .in('id', taskIds)
        .eq('is_published', true)
        .order('position')

      if (e2 || cancelled) { if (!cancelled) { setError(e2?.message ?? ''); setLoading(false) } return }

      // Assets: chunk .in() ≤50 UUIDs to avoid URL truncation, paginate rows
      const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
      const ASSET_PAGE  = 1000
      const ASSET_CHUNK = 50
      for (let ci = 0; ci < taskIds.length; ci += ASSET_CHUNK) {
        const chunk = taskIds.slice(ci, ci + ASSET_CHUNK)
        for (let from = 0; ; from += ASSET_PAGE) {
          const { data: assetPage } = await db
            .from('catalog_task_assets')
            .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
            .in('task_id', chunk)
            .order('position')
            .range(from, from + ASSET_PAGE - 1)
          if (!assetPage || assetPage.length === 0) break
          allAssets.push(...(assetPage as (CatalogTaskAsset & { task_id: string })[]))
          if (assetPage.length < ASSET_PAGE) break
        }
      }
      const assetsData = allAssets

      const { data: progressData } = await db
        .from('catalog_task_progress')
        .select('task_id, is_completed')
        .in('task_id', taskIds)
        .eq('is_completed', true)

      if (cancelled) return

      const assetsByTask: Record<string, CatalogTaskAsset[]> = {}
      for (const a of assetsData ?? []) {
        const aid = (a as CatalogTaskAsset & { task_id: string }).task_id
        if (!assetsByTask[aid]) assetsByTask[aid] = []
        assetsByTask[aid].push(a as CatalogTaskAsset)
      }

      const done = new Set<string>((progressData ?? []).map((p: { task_id: string }) => p.task_id))
      setCompletedIds(done)
      setTasks(
        (tasksData ?? []).map((t: CatalogTask) => ({
          ...t,
          assets:       assetsByTask[t.id] ?? [],
          is_completed: done.has(t.id),
        }))
      )
      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [profile, topicId])

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

  return { tasks, loading, error, completedIds, toggleComplete }
}
