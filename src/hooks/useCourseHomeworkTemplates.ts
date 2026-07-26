import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface CourseHomeworkTemplate {
  id: string
  title: string
  topic_id: string | null
  status: 'draft' | 'active' | 'archived'
  latest_version_id: string
  latest_version: number
  items_count: number
  assignments_count: number
  last_assigned_at: string | null
}

/** Homework V2 templates for a course, with version/items/assignment counts — used by
 * CourseProgramPage to replace the legacy homeworks list. Reads only homework_templates/
 * homework_template_versions/homework_template_items/homework_assignments. */
export function useCourseHomeworkTemplates(courseId: string | null | undefined) {
  const [templates, setTemplates] = useState<CourseHomeworkTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!courseId) { setTemplates([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const { data: tpls, error: tErr } = await supabase
          .from('homework_templates')
          .select('id, title, topic_id, status')
          .eq('course_id', courseId)
          .order('created_at', { ascending: false })
        if (tErr) throw tErr
        if (!tpls || tpls.length === 0) { if (!cancelled) setTemplates([]); return }

        const templateIds = tpls.map(t => t.id)
        const { data: versions, error: vErr } = await supabase
          .from('homework_template_versions')
          .select('id, template_id, version')
          .in('template_id', templateIds)
        if (vErr) throw vErr

        const latestVersionByTemplate = new Map<string, { id: string; version: number }>()
        for (const v of versions || []) {
          const cur = latestVersionByTemplate.get(v.template_id)
          if (!cur || v.version > cur.version) latestVersionByTemplate.set(v.template_id, { id: v.id, version: v.version })
        }
        const versionIds = [...latestVersionByTemplate.values()].map(v => v.id)

        const [{ data: items, error: iErr }, { data: assignments, error: aErr }] = await Promise.all([
          versionIds.length
            ? supabase.from('homework_template_items').select('template_version_id').in('template_version_id', versionIds)
            : Promise.resolve({ data: [], error: null }),
          versionIds.length
            ? supabase.from('homework_assignments').select('template_version_id, created_at').in('template_version_id', versionIds)
            : Promise.resolve({ data: [], error: null }),
        ])
        if (iErr) throw iErr
        if (aErr) throw aErr

        const itemsCountByVersion = new Map<string, number>()
        for (const it of items || []) itemsCountByVersion.set(it.template_version_id, (itemsCountByVersion.get(it.template_version_id) || 0) + 1)

        const assignCountByVersion = new Map<string, number>()
        const lastAssignedByVersion = new Map<string, string>()
        for (const a of assignments || []) {
          assignCountByVersion.set(a.template_version_id, (assignCountByVersion.get(a.template_version_id) || 0) + 1)
          const cur = lastAssignedByVersion.get(a.template_version_id)
          if (!cur || a.created_at > cur) lastAssignedByVersion.set(a.template_version_id, a.created_at)
        }

        if (cancelled) return
        setTemplates(tpls.map(t => {
          const latest = latestVersionByTemplate.get(t.id)
          return {
            id: t.id, title: t.title, topic_id: t.topic_id, status: t.status,
            latest_version_id: latest?.id || '', latest_version: latest?.version ?? 0,
            items_count: latest ? (itemsCountByVersion.get(latest.id) || 0) : 0,
            assignments_count: latest ? (assignCountByVersion.get(latest.id) || 0) : 0,
            last_assigned_at: latest ? (lastAssignedByVersion.get(latest.id) || null) : null,
          }
        }))
      } catch (e: any) {
        if (!cancelled) { setError(e?.message || 'Не удалось загрузить шаблоны'); setTemplates([]) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [courseId, tick])

  return { templates, loading, error, reload }
}
