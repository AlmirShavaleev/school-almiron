import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface HomeworkTemplateOption {
  id: string
  title: string
  course_id: string
  latest_version_id: string
  latest_version: number
  max_score: number | null
}

/** Active templates for a course, newest version per template. */
export function useHomeworkTemplates(courseId: string | null | undefined) {
  const [templates, setTemplates] = useState<HomeworkTemplateOption[]>([])
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
        const { data, error: err } = await supabase
          .from('homework_templates')
          .select('id, title, course_id, status, homework_template_versions(id, version, max_score)')
          .eq('course_id', courseId)
          .eq('status', 'active')
        if (cancelled) return
        if (err) { setError(err.message); setTemplates([]); return }
        const opts: HomeworkTemplateOption[] = (data || []).map(t => {
          const versions = t.homework_template_versions || []
          let latest: (typeof versions)[number] | null = null
          for (const v of versions) if (!latest || v.version > latest.version) latest = v
          return {
            id: t.id,
            title: t.title,
            course_id: t.course_id,
            latest_version_id: latest?.id ?? '',
            latest_version: latest?.version ?? 0,
            max_score: latest?.max_score ?? null,
          }
        }).filter(t => t.latest_version_id)
        setTemplates(opts)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [courseId, tick])

  async function createTemplate(input: { title: string; instructions?: string; maxScore?: number; topicId?: string | null }) {
    // p_template_id/p_topic_id/p_instructions/p_max_score/p_items/p_files are nullable in the
    // DB function (no SQL DEFAULT NOT NULL); the generator types them as required strings —
    // cast only these nullable fields, not the whole call.
    const { data, error: err } = await supabase.rpc('create_or_update_template_draft', {
      p_template_id: null as unknown as string,
      p_course_id: courseId as string,
      p_topic_id: (input.topicId ?? null) as unknown as string,
      p_title: input.title,
      p_instructions: (input.instructions ?? null) as unknown as string,
      p_pdf_config: {},
      p_max_score: (input.maxScore ?? null) as unknown as number,
      p_items: null,
      p_files: null,
    })
    if (err) throw err
    reload()
    return data as { template_id: string; template_version_id: string; version: number }
  }

  return { templates, loading, error, reload, createTemplate }
}
