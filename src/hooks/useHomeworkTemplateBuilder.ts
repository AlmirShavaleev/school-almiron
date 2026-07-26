import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { CatalogTask } from '@/hooks/useCatalog'
import type { HomeworkGradingMode } from '@/types/homeworkGrading'
import { autofillGradingFromCatalogTask } from '@/lib/homeworkGradingAutofill'
import type { Database } from '@/types/database'

export interface BuilderItem {
  key: string // stable client-side key (catalog_task_id) for list rendering/reorder
  catalog_task_id: string
  task: CatalogTask
  custom_number: string
  max_score: number | null
  grading_mode: HomeworkGradingMode
  grading_spec: Record<string, unknown>
  ai_check_enabled: boolean
}

export function useHomeworkTemplateBuilder() {
  const [items, setItems] = useState<BuilderItem[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addTask(task: CatalogTask) {
    setItems(prev => {
      if (prev.some(i => i.catalog_task_id === task.id)) return prev
      const seed = autofillGradingFromCatalogTask(task)
      return [...prev, {
        key: task.id,
        catalog_task_id: task.id,
        task,
        custom_number: '',
        max_score: seed.max_score,
        grading_mode: seed.grading_mode,
        grading_spec: seed.grading_spec,
        ai_check_enabled: false,
      }]
    })
  }

  function removeTask(catalogTaskId: string) {
    setItems(prev => prev.filter(i => i.catalog_task_id !== catalogTaskId))
  }

  function isSelected(catalogTaskId: string) {
    return items.some(i => i.catalog_task_id === catalogTaskId)
  }

  function moveItem(index: number, direction: -1 | 1) {
    setItems(prev => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function updateItem(catalogTaskId: string, patch: Partial<Pick<BuilderItem, 'custom_number' | 'max_score' | 'grading_mode' | 'grading_spec' | 'ai_check_enabled'>>) {
    setItems(prev => prev.map(i => i.catalog_task_id === catalogTaskId ? { ...i, ...patch } : i))
  }

  function replaceItems(nextItems: BuilderItem[]) {
    setItems(nextItems)
  }

  function clear() {
    setItems([])
  }

  async function save(input: { templateId: string | null; courseId: string; topicId?: string | null; title: string; instructions: string; maxScore: number | null }) {
    setSaving(true)
    setError(null)
    try {
      const payloadItems = items.map((it, idx) => ({
        catalog_task_id: it.catalog_task_id,
        position: idx + 1,
        custom_number: it.custom_number || null,
        max_score: it.max_score,
        grading_mode: it.grading_mode,
        grading_spec: it.grading_spec,
        ai_check_enabled: it.ai_check_enabled,
      }))
      const { data, error: err } = await supabase.rpc('create_or_update_template_draft', {
        p_template_id: input.templateId as unknown as string,
        p_course_id: input.courseId,
        p_topic_id: (input.topicId ?? null) as unknown as string,
        p_title: input.title,
        p_instructions: (input.instructions || null) as unknown as string,
        p_pdf_config: {},
        p_max_score: input.maxScore as unknown as number,
        p_items: (payloadItems.length ? payloadItems : null) as unknown as Database['public']['Functions']['create_or_update_template_draft']['Args']['p_items'],
        p_files: null,
      })
      if (err) throw err
      return data as { template_id: string; template_version_id: string; version: number }
    } catch (e: any) {
      setError(e?.message || 'Не удалось сохранить шаблон')
      throw e
    } finally {
      setSaving(false)
    }
  }

  return { items, addTask, removeTask, isSelected, moveItem, updateItem, replaceItems, clear, save, saving, error }
}
