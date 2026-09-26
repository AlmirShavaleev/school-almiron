import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { MockExamTemplate } from '@/hooks/useMockExamGrid'

/**
 * §218. Шаблоны пробников — структура экзамена на год. Читает весь
 * персонал (преподаватель выбирает шаблон, заводя пробник), пишет только
 * владелец/админ платформы — так стоят политики `PENDING_218.sql`.
 */

type Res<T> = { data: T | null; error: { message?: string } | null }
interface Chain<T> extends PromiseLike<Res<T>> {
  select(columns: string): Chain<T>
  order(column: string, opts?: { ascending?: boolean }): Chain<T>
  eq(column: string, value: string): Chain<T>
  insert(row: unknown): Chain<T>
  update(row: unknown): Chain<T>
  single(): PromiseLike<Res<T>>
}
const db = supabase as unknown as { from<T = unknown>(table: string): Chain<T> }

export type TemplateDraft = Omit<MockExamTemplate, 'id'> & { id?: string }

export function normalize(t: any): MockExamTemplate {
  return {
    ...t,
    year: Number(t.year),
    max_points: (t.max_points ?? []).map(Number),
    part1_last: Number(t.part1_last),
    score_scale: t.score_scale ? t.score_scale.map(Number) : null,
  }
}

export function useMockExamTemplates(enabled = true) {
  const [templates, setTemplates] = useState<MockExamTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error: err } = await db
        .from<any[]>('mock_exam_templates')
        .select('id, title, subject, exam_type, year, max_points, part1_last, score_scale')
        .order('year', { ascending: false })
      if (cancelled) return
      setError(err?.message ?? null)
      setTemplates((data ?? []).map(normalize))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [enabled, tick])

  const reload = useCallback(() => setTick(t => t + 1), [])

  const saveTemplate = useCallback(async (draft: TemplateDraft): Promise<{ error: string | null; id?: string }> => {
    const row = {
      title: draft.title.trim(),
      subject: draft.subject,
      exam_type: draft.exam_type,
      year: draft.year,
      max_points: draft.max_points,
      part1_last: draft.part1_last,
      score_scale: draft.score_scale,
    }
    const q = draft.id
      ? db.from<any>('mock_exam_templates').update(row).eq('id', draft.id).select('id').single()
      : db.from<any>('mock_exam_templates').insert(row).select('id').single()
    const { data, error: err } = await q
    if (err) return { error: err.message || 'Не удалось сохранить шаблон' }
    reload()
    return { error: null, id: data?.id }
  }, [reload])

  return { templates, loading, error, reload, saveTemplate }
}
