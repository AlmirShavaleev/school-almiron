import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import type { CatalogTask, CatalogTaskAsset } from '@/hooks/useCatalog'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TestVariant {
  id: string
  title: string
  description: string | null
  subject: string
  exam_type: string
  status: 'draft' | 'ready'
  created_by: string
  settings: VariantSettings
  tasks_count: number
  created_at: string
  updated_at: string
  created_by_profile?: { full_name: string; email: string }
}

export interface VariantSettings {
  sections: VariantSectionConfig[]
  generation_mode: 'random'
}

export interface VariantSectionConfig {
  section_id: string
  cnt: number
  topic_ids: string[]
}

export interface TestVariantItem {
  id: string
  variant_id: string
  task_id: string
  position: number
  section_id: string | null
  topic_id: string | null
  points: number
  task?: CatalogTask & { assets?: CatalogTaskAsset[]; sectionTitle?: string | null }
}

export interface GeneratedTask {
  task_id: string
  section_id: string
  topic_id: string
  position: number
  task?: CatalogTask & { assets?: CatalogTaskAsset[]; sectionTitle?: string | null }
}

type TaskFieldVisibility = 'full' | 'student_safe'

const FULL_TASK_SELECT = 'id, external_id, section_id, subject, exam_type, statement_html, answer_html, solution_html, solution_plan_html, grade_criteria_html, source_url, has_answer, has_solution, position, catalog_sections(title)'
const STUDENT_SAFE_TASK_SELECT = 'id, external_id, section_id, subject, exam_type, statement_html, source_url, has_answer, has_solution, position, exam_part, catalog_sections(title)'

function getTaskSelect(visibility: TaskFieldVisibility) {
  return visibility === 'student_safe' ? STUDENT_SAFE_TASK_SELECT : FULL_TASK_SELECT
}

// ── useVariants (список) ─────────────────────────────────────────────────────

export function useVariants(filters?: {
  subject?: string
  exam_type?: string
  status?: string
  search?: string
}) {
  const { profile } = useAuthStore()
  const [variants, setVariants]   = useState<TestVariant[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setError(null)

    let q = db
      .from('test_variants')
      .select('*, created_by_profile:profiles!created_by(full_name, email)')
      .order('updated_at', { ascending: false })

    if (filters?.subject)   q = q.eq('subject',   filters.subject)
    if (filters?.exam_type) q = q.eq('exam_type', filters.exam_type)
    if (filters?.status)    q = q.eq('status',    filters.status)
    if (filters?.search)    q = q.ilike('title', `%${filters.search}%`)

    const { data, error: e } = await q
    if (e) { setError(e.message); setLoading(false); return }
    setVariants(data ?? [])
    setLoading(false)
  }, [profile, filters?.subject, filters?.exam_type, filters?.status, filters?.search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const deleteVariant = useCallback(async (id: string) => {
    await db.from('test_variants').delete().eq('id', id)
    setVariants(prev => prev.filter(v => v.id !== id))
  }, [])

  return { variants, loading, error, reload: load, deleteVariant }
}

// ── useVariantDetail (один вариант со всеми задачами) ────────────────────────

export function useVariantDetail(variantId: string | undefined) {
  const { profile } = useAuthStore()
  const [variant, setVariant]   = useState<TestVariant | null>(null)
  const [items, setItems]       = useState<TestVariantItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profile || !variantId) return
    setLoading(true)
    setError(null)

    const { data: vData, error: e1 } = await db
      .from('test_variants')
      .select('*, created_by_profile:profiles!created_by(full_name, email)')
      .eq('id', variantId)
      .maybeSingle()

    if (e1 || !vData) {
      setError(e1?.message ?? 'Вариант не найден')
      setLoading(false)
      return
    }
    setVariant(vData)

    const { data: itemsData, error: e2 } = await db
      .from('test_variant_items')
      .select('*')
      .eq('variant_id', variantId)
      .order('position')

    if (e2) { setError(e2.message); setLoading(false); return }

    const taskIds = (itemsData ?? []).map((i: TestVariantItem) => i.task_id)
    if (!taskIds.length) { setItems([]); setLoading(false); return }

    const { data: tasksData } = await db
      .from('catalog_tasks')
      .select('id, external_id, section_id, subject, exam_type, statement_html, answer_html, solution_html, solution_plan_html, grade_criteria_html, source_url, has_answer, has_solution, position, catalog_sections(title)')
      .in('id', taskIds)

    // Assets: chunk .in() ≤50 UUIDs to avoid URL truncation, paginate rows
    const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
    const PAGE  = 1000
    const CHUNK = 50
    for (let ci = 0; ci < taskIds.length; ci += CHUNK) {
      const chunk = taskIds.slice(ci, ci + CHUNK)
      for (let from = 0; ; from += PAGE) {
        const { data: aPage } = await db
          .from('catalog_task_assets')
          .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
          .in('task_id', chunk)
          .order('position')
          .range(from, from + PAGE - 1)
        if (!aPage || aPage.length === 0) break
        allAssets.push(...aPage)
        if (aPage.length < PAGE) break
      }
    }

    const taskMap: Record<string, CatalogTask & { assets: CatalogTaskAsset[]; sectionTitle?: string | null }> = {}
    for (const t of tasksData ?? []) {
      const { catalog_sections, ...rest } = t as typeof t & { catalog_sections?: { title: string } | null }
      taskMap[t.id] = { ...rest, assets: [], sectionTitle: catalog_sections?.title ?? null }
    }
    for (const a of allAssets) {
      if (taskMap[a.task_id]) taskMap[a.task_id].assets.push(a)
    }

    setItems(
      (itemsData ?? []).map((item: TestVariantItem) => ({
        ...item,
        task: taskMap[item.task_id],
      }))
    )
    setLoading(false)
  }, [profile, variantId])

  useEffect(() => { load() }, [load])

  return { variant, items, loading, error, reload: load }
}

// ── useVariantBuilder (логика конструктора) ───────────────────────────────────

export function useVariantBuilder() {
  const { profile } = useAuthStore()
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [genError, setGenError]     = useState<string | null>(null)

  /**
   * Генерирует задачи через RPC, загружает их данные и возвращает список.
   */
  const generateTasks = useCallback(async (
    sections: VariantSectionConfig[],
    options?: TaskFieldVisibility | { visibility?: TaskFieldVisibility; hydrateTasks?: boolean },
  ): Promise<GeneratedTask[]> => {
    if (!profile) throw new Error('Not authenticated')
    setGenerating(true)
    setGenError(null)
    const visibility =
      typeof options === 'string' ? options : options?.visibility ?? 'full'
    const hydrateTasks =
      typeof options === 'string' ? true : options?.hydrateTasks ?? true

    try {
      const { data, error } = await db.rpc('generate_variant_tasks', {
        p_sections: sections.map(s => ({
          section_id: s.section_id,
          cnt:        s.cnt,
          topic_ids:  s.topic_ids.length ? s.topic_ids : null,
        })),
      })

      if (error) {
        // Парсим структурированную ошибку нехватки задач
        const msg: string = error.message ?? ''
        const match = msg.match(/NOT_ENOUGH_TASKS:section=([^:]+):topic=([^:]+):needed=(\d+):available=(\d+)/)
        if (match) {
          throw new Error(`NOT_ENOUGH:section=${match[1]}:topic=${match[2]}:needed=${match[3]}:available=${match[4]}`)
        }
        throw new Error(error.message)
      }

      const rows: { out_task_id: string; out_section_id: string; out_topic_id: string; out_position: number }[] = data ?? []
      if (!rows.length) return []
      if (!hydrateTasks) {
        return rows.map(r => ({
          task_id: r.out_task_id,
          section_id: r.out_section_id,
          topic_id: r.out_topic_id,
          position: r.out_position,
        }))
      }

      const taskIds = rows.map(r => r.out_task_id)

      // Загружаем данные задач
      const { data: tasksData } = await db
        .from('catalog_tasks')
        .select(getTaskSelect(visibility))
        .in('id', taskIds)

      // Assets: chunk .in() ≤50 UUIDs to avoid URL truncation, paginate rows
      const allAssets: (CatalogTaskAsset & { task_id: string })[] = []
      const PAGE  = 1000
      const CHUNK = 50
      for (let ci = 0; ci < taskIds.length; ci += CHUNK) {
        const chunk = taskIds.slice(ci, ci + CHUNK)
        for (let from = 0; ; from += PAGE) {
          const { data: aPage } = await db
            .from('catalog_task_assets')
            .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
            .in('task_id', chunk)
            .order('position')
            .range(from, from + PAGE - 1)
          if (!aPage || aPage.length === 0) break
          allAssets.push(...aPage)
          if (aPage.length < PAGE) break
        }
      }

      const taskMap: Record<string, CatalogTask & { assets: CatalogTaskAsset[]; sectionTitle?: string | null }> = {}
      for (const t of tasksData ?? []) {
        const { catalog_sections, ...rest } = t as typeof t & { catalog_sections?: { title: string } | null }
        taskMap[t.id] = { ...rest, assets: [], sectionTitle: catalog_sections?.title ?? null }
      }
      for (const a of allAssets) {
        if (taskMap[a.task_id]) taskMap[a.task_id].assets.push(a)
      }

      return rows.map(r => ({
        task_id:    r.out_task_id,
        section_id: r.out_section_id,
        topic_id:   r.out_topic_id,
        position:   r.out_position,
        task:       taskMap[r.out_task_id],
      }))
    } finally {
      setGenerating(false)
    }
  }, [profile])

  /**
   * Атомарно сохраняет вариант.
   */
  const saveVariant = useCallback(async (params: {
    variantId: string | null
    title: string
    description: string
    subject: string
    examType: string
    status: 'draft' | 'ready'
    settings: VariantSettings
    items: GeneratedTask[]
  }): Promise<string> => {
    if (!profile) throw new Error('Not authenticated')
    setSaving(true)
    try {
      const { data, error } = await db.rpc('save_variant_atomic', {
        p_variant_id:  params.variantId ?? null,
        p_title:       params.title,
        p_description: params.description || null,
        p_subject:     params.subject,
        p_exam_type:   params.examType,
        p_status:      params.status,
        p_settings:    params.settings,
        p_items:       params.items.map((t, idx) => ({
          task_id:    t.task_id,
          pos:        idx + 1,
          section_id: t.section_id,
          topic_id:   t.topic_id,
          points:     1,
        })),
      })
      if (error) throw new Error(error.message)
      return data as string
    } finally {
      setSaving(false)
    }
  }, [profile])

  /**
   * Заменяет одну задачу через RPC, загружает данные новой задачи.
   */
  const replaceTask = useCallback(async (
    variantId: string,
    oldTaskId: string,
    sectionId: string,
    topicId: string
  ): Promise<(CatalogTask & { assets: CatalogTaskAsset[] }) | null> => {
    if (!profile) return null
    const { data: newId, error } = await db.rpc('replace_variant_task', {
      p_variant_id:  variantId,
      p_old_task_id: oldTaskId,
      p_section_id:  sectionId,
      p_topic_id:    topicId,
    })
    if (error || !newId) return null

    const { data: t } = await db
      .from('catalog_tasks')
      .select('id, external_id, section_id, subject, exam_type, statement_html, answer_html, solution_html, solution_plan_html, grade_criteria_html, has_answer, has_solution, position')
      .eq('id', newId)
      .maybeSingle()
    if (!t) return null

    const { data: assets } = await db
      .from('catalog_task_assets')
      .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
      .eq('task_id', newId)
      .order('position')

    return { ...t, assets: assets ?? [] }
  }, [profile])

  /**
   * Находит случайную задачу (без сохранённого variantId — для builder'а в памяти).
   */
  const findReplacementTask = useCallback(async (
    sectionId: string,
    topicId: string,
    excludeIds: string[]
  ): Promise<(CatalogTask & { assets: CatalogTaskAsset[] }) | null> => {
    if (!profile) return null
    const { data: taskRow } = await db
      .from('catalog_tasks')
      .select('id')
      .eq('section_id', sectionId)
      .eq('is_published', true)
      .not('id', 'in', `(${excludeIds.map(i => `'${i}'`).join(',')})`)
      .limit(1)
      // random ordering via a join trick is not available via PostgREST easily
      // We'll use a workaround: fetch a small batch and pick random
    if (!taskRow || taskRow.length === 0) {
      // Try without excludes (fallback: get IDs that have this topic)
      const { data: ids } = await db
        .from('catalog_task_topics')
        .select('task_id')
        .eq('topic_id', topicId)
        .limit(500)
      const allIds: string[] = (ids ?? []).map((r: { task_id: string }) => r.task_id)
      const available = allIds.filter(id => !excludeIds.includes(id))
      if (!available.length) return null
      const picked = available[Math.floor(Math.random() * available.length)]
      return loadSingleTask(picked)
    }
    return null
  }, [profile])

  return { generateTasks, saveVariant, replaceTask, findReplacementTask, generating, saving, genError, setGenError }
}

// ── Student self-built variants ──────────────────────────────────────────────

export interface SelfBuiltVariantTaskInput {
  task_id: string
  section_id: string | null
  topic_id: string | null
}

/** Student builds their own variant from a cart of catalog tasks. Returns the
 * new student_assignment_id (self-assignment) on success. */
export function useCreateSelfBuiltVariant() {
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const create = useCallback(async (params: {
    title: string
    subject: string
    examType: string
    items: SelfBuiltVariantTaskInput[]
  }): Promise<string | null> => {
    setSaving(true)
    setError(null)
    try {
      const { data, error: err } = await db.rpc('create_self_built_variant', {
        p_title:     params.title,
        p_subject:   params.subject,
        p_exam_type: params.examType,
        p_items:     params.items.map((t, idx) => ({
          task_id:    t.task_id,
          pos:        idx + 1,
          section_id: t.section_id,
          topic_id:   t.topic_id,
          points:     1,
        })),
      })
      if (err) throw new Error(err.message)
      return data as string
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка создания варианта')
      return null
    } finally {
      setSaving(false)
    }
  }, [])

  return { create, saving, error }
}

async function loadSingleTask(taskId: string): Promise<(CatalogTask & { assets: CatalogTaskAsset[] }) | null> {
  return loadSingleTaskWithVisibility(taskId, 'full')
}

async function loadSingleTaskWithVisibility(taskId: string, visibility: TaskFieldVisibility): Promise<(CatalogTask & { assets: CatalogTaskAsset[] }) | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db2 = supabase as any
  const { data: t } = await db2
    .from('catalog_tasks')
    .select(getTaskSelect(visibility))
    .eq('id', taskId)
    .maybeSingle()
  if (!t) return null
  const { data: assets } = await db2
    .from('catalog_task_assets')
    .select('id, task_id, tex_session_id, kind, storage_path, alt, position')
    .eq('task_id', taskId)
    .order('position')
  return { ...t, assets: assets ?? [] }
}
