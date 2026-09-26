import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { uploadToStorage } from '@/lib/storageUpload'
import { MOCK_EXAMS_BUCKET, mockExamFilePath } from '@/lib/mockExamLesson'
import { normalize as normalizeTemplate } from '@/hooks/useMockExamTemplates'
import type { MockExamTemplate } from '@/hooks/useMockExamGrid'

/**
 * §221. Настройка пробника-урока у преподавателя: окно, место в программе
 * курса, условие и решение (PDF), ключ первой части.
 *
 * Поля пробника пишутся прямо в `mock_exams` — под существующей политикой
 * `mock_exams_manage` (политики этой работой не тронуты). Раздел из чужого
 * курса и окно без шаблона отсекает триггер `mock_exams_lesson_guard`. Ключ —
 * функцией `save_mock_exam_key`: она же перепроверяет законченные бланки.
 */

type Res<T> = { data: T | null; error: { message?: string; code?: string } | null }
interface Chain<T> extends PromiseLike<Res<T>> {
  select(columns: string): Chain<T>
  eq(column: string, value: string): Chain<T>
  order(column: string, opts?: { ascending?: boolean }): Chain<T>
  update(row: unknown): Chain<T>
  maybeSingle(): PromiseLike<Res<T>>
}
interface DbLike {
  from<T = unknown>(table: string): Chain<T>
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): PromiseLike<Res<T>>
}
const db = supabase as unknown as DbLike

export interface SetupExam {
  id: string
  title: string
  date: string
  group_id: string | null
  groupName: string | null
  courseId: string | null
  template_id: string | null
  template: MockExamTemplate | null
  module_id: string | null
  module_position: number
  starts_at: string | null
  duration_minutes: number
  photo_grace_minutes: number
  condition_path: string | null
  solution_path: string | null
}

export interface SetupModule {
  id: string
  title: string
  order_index: number
  topics: { id: string; title: string; order_index: number }[]
}

export interface SetupDraft {
  title: string
  starts_at: string | null
  duration_minutes: number
  template_id: string | null
  module_id: string | null
  module_position: number
}

const EXAM_COLUMNS = 'id, title, date, group_id, template_id, module_id, module_position, starts_at, duration_minutes, photo_grace_minutes, condition_path, solution_path, groups(name, course_id), mock_exam_templates(id, title, subject, exam_type, year, max_points, part1_last, score_scale)'

export function useMockExamSetup(examId: string | undefined) {
  const [exam, setExam] = useState<SetupExam | null>(null)
  const [modules, setModules] = useState<SetupModule[]>([])
  const [key, setKey] = useState<(string | null)[] | null>(null)
  const [hasScores, setHasScores] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!examId) return
    let cancelled = false
    ;(async () => {
      setError(null)
      const { data: e, error: eErr } = await db.from<any>('mock_exams').select(EXAM_COLUMNS).eq('id', examId).maybeSingle()
      if (cancelled) return
      if (eErr || !e) {
        // Колонок §221 ещё нет (ветка влита раньше миграции) — так и сказать.
        setError(eErr?.message ? `Не удалось открыть пробник: ${eErr.message}` : 'Пробник не найден')
        setLoading(false)
        return
      }
      const ex: SetupExam = {
        id: e.id, title: e.title, date: e.date, group_id: e.group_id ?? null,
        groupName: e.groups?.name ?? null, courseId: e.groups?.course_id ?? null,
        template_id: e.template_id ?? null,
        template: e.mock_exam_templates ? normalizeTemplate(e.mock_exam_templates) : null,
        module_id: e.module_id ?? null, module_position: Number(e.module_position ?? 0),
        starts_at: e.starts_at ?? null,
        duration_minutes: Number(e.duration_minutes ?? 240),
        photo_grace_minutes: Number(e.photo_grace_minutes ?? 15),
        condition_path: e.condition_path ?? null, solution_path: e.solution_path ?? null,
      }
      const [mods, k, sc] = await Promise.all([
        ex.courseId
          ? db.from<any[]>('modules').select('id, title, order_index, topics(id, title, order_index)').eq('course_id', ex.courseId).order('order_index')
          : Promise.resolve({ data: [], error: null } as Res<any[]>),
        db.from<{ answers: (string | null)[] }>('mock_exam_answer_keys').select('answers').eq('mock_exam_id', ex.id).maybeSingle(),
        db.from<{ task_number: number }[]>('mock_exam_task_scores').select('task_number').eq('mock_exam_id', ex.id),
      ])
      if (cancelled) return
      setExam(ex)
      setModules(((mods.data ?? []) as any[]).map(m => ({
        id: m.id, title: m.title, order_index: m.order_index,
        topics: ((m.topics ?? []) as SetupModule['topics']).slice().sort((a, b) => a.order_index - b.order_index),
      })))
      setKey(k.data?.answers ?? null)
      setHasScores(((sc.data ?? []) as unknown[]).length > 0)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [examId, tick])

  const saveSettings = useCallback(async (d: SetupDraft): Promise<{ error: string | null }> => {
    if (!exam) return { error: 'Пробник не загружен' }
    const row: Record<string, unknown> = {
      title: d.title.trim(),
      starts_at: d.starts_at,
      duration_minutes: d.duration_minutes,
      template_id: d.template_id,
      module_id: d.module_id,
      module_position: d.module_position,
    }
    // День пробника в списке и в уведомлении (§219) — день начала.
    if (d.starts_at) row.date = d.starts_at
    const { error: err } = await db.from('mock_exams').update(row).eq('id', exam.id)
    if (err) return { error: err.message || 'Не сохранилось' }
    reload()
    return { error: null }
  }, [exam, reload])

  /** Условие или решение: новый объект в бакете, затем путь в пробнике. */
  const uploadFile = useCallback(async (kind: 'condition' | 'solution', file: File, onProgress?: (p: number) => void): Promise<{ error: string | null }> => {
    if (!exam) return { error: 'Пробник не загружен' }
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return { error: 'Нужен PDF' }
    const path = mockExamFilePath(exam.id, kind, file.name)
    try {
      await uploadToStorage(MOCK_EXAMS_BUCKET, path, file, onProgress)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Не удалось загрузить' }
    }
    const column = kind === 'condition' ? 'condition_path' : 'solution_path'
    const old = kind === 'condition' ? exam.condition_path : exam.solution_path
    const { error: err } = await db.from('mock_exams').update({ [column]: path }).eq('id', exam.id)
    if (err) {
      await supabase.storage.from(MOCK_EXAMS_BUCKET).remove([path])
      return { error: err.message || 'Не сохранилось' }
    }
    if (old && old !== path) await supabase.storage.from(MOCK_EXAMS_BUCKET).remove([old])
    reload()
    return { error: null }
  }, [exam, reload])

  const saveKey = useCallback(async (answers: string[]): Promise<{ error: string | null; notCheckable: number[]; changed: number }> => {
    if (!exam) return { error: 'Пробник не загружен', notCheckable: [], changed: 0 }
    const { data, error: err } = await db.rpc<{ not_checkable: number[]; grade: { changed_cells: number } }>('save_mock_exam_key', {
      p_mock_exam_id: exam.id, p_answers: answers,
    })
    if (err) return { error: err.message || 'Ключ не сохранён', notCheckable: [], changed: 0 }
    setKey(answers.map(a => a.trim() || null))
    return { error: null, notCheckable: data?.not_checkable ?? [], changed: data?.grade?.changed_cells ?? 0 }
  }, [exam])

  return { exam, modules, key, hasScores, loading, error, reload, saveSettings, uploadFile, saveKey }
}
