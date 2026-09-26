import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Типы базы не перегенерированы после §221 — строки новых таблиц через `any` (как в lib/myMockExams).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalize as normalizeTemplate } from '@/hooks/useMockExamTemplates'
import type { MockExamTemplate } from '@/hooks/useMockExamGrid'
import type { MockExamResultNotifyRow, NotifySummary } from '@/lib/mockExamNotify'
import { windowOf, type ExamWindow, type WorkInput } from '@/lib/mockExamV3'

/**
 * §228. Данные страницы пробника («Работы») и экрана проверки работы: пробник,
 * шаблон, ученики группы, баллы с отметкой «авто», бланки (ответы первой
 * части), фото, итоги с отметкой отправки, ключ.
 *
 * Всё читается под RLS персонала, новых функций в базе не понадобилось:
 * `mock_exam_sheets_staff_select`, `mock_exam_photos_staff_select`,
 * `mock_exam_answer_keys_staff_select` и `mock_exam_task_scores_staff_select`
 * пускают персонал курса группы пробника (`mock_exam_is_staff`, §218/§221), а
 * ученика и чужого преподавателя — нет (пробы §228).
 *
 * Сохранение — существующей `save_mock_exam_grid` одной строкой ученика
 * (функция трогает только переданных учеников), уведомление —
 * `notify_mock_exam_results(exam, [ученик])` (§219). Как и таблица §221, при
 * открытии зовём `grade_mock_exam_part1`: первая часть законченных бланков
 * проверяется ключом до чтения баллов.
 */

type Res<T> = { data: T | null; error: { message?: string; code?: string } | null }
interface Chain<T> extends PromiseLike<Res<T>> {
  select(columns: string): Chain<T>
  eq(column: string, value: string): Chain<T>
  maybeSingle(): PromiseLike<Res<T>>
}
interface DbLike {
  from<T = unknown>(table: string): Chain<T>
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): PromiseLike<Res<T>>
}
const db = supabase as unknown as DbLike

export interface WorksExam {
  id: string
  title: string
  date: string
  group_id: string | null
  groupName: string | null
  courseId: string | null
  template: MockExamTemplate | null
  window: ExamWindow | null
  condition_path: string | null
  solution_path: string | null
}

export interface WorksPhoto { id: string; storage_path: string; file_name: string; position: number }

export interface WorksStudent extends WorkInput {
  photoList: WorksPhoto[]
}

const RESULT_COLUMNS = 'student_id, score, part1_score, part2_score, notified_at, notified_score, notified_part1_score, notified_part2_score'

export function useMockExamWorks(examId: string | undefined) {
  const [exam, setExam] = useState<WorksExam | null>(null)
  const [students, setStudents] = useState<WorksStudent[]>([])
  const [key, setKey] = useState<(string | null)[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!examId) return
    let cancelled = false
    ;(async () => {
      setError(null)
      const { data: e, error: eErr } = await db.from<any>('mock_exams')
        .select('id, title, date, group_id, template_id, starts_at, duration_minutes, photo_grace_minutes, condition_path, solution_path, groups(name, course_id), mock_exam_templates(id, title, subject, exam_type, year, max_points, part1_last, score_scale)')
        .eq('id', examId).maybeSingle()
      if (cancelled) return
      if (eErr || !e) { setError(eErr?.message || 'Пробник не найден'); setLoading(false); return }
      const template = e.mock_exam_templates ? normalizeTemplate(e.mock_exam_templates) : null
      const win = e.starts_at ? windowOf(e) : null
      const ex: WorksExam = {
        id: e.id, title: e.title, date: e.date, group_id: e.group_id ?? null,
        groupName: e.groups?.name ?? null, courseId: e.groups?.course_id ?? null,
        template, window: win,
        condition_path: e.condition_path ?? null, solution_path: e.solution_path ?? null,
      }
      if (!ex.group_id || !template) {
        setExam(ex); setStudents([]); setKey(null); setLoading(false)
        return
      }
      // Первая часть законченных бланков — по ключу, до чтения баллов (как у таблицы §221).
      if (win) {
        try { await db.rpc('grade_mock_exam_part1', { p_mock_exam_id: ex.id }) } catch { /* таблица работает и без этого */ }
        if (cancelled) return
      }
      const [gs, sc, sh, ph, rs, k] = await Promise.all([
        db.from<any[]>('group_students').select('student_id, students(id, profile_id, profiles(full_name))').eq('group_id', ex.group_id),
        db.from<any[]>('mock_exam_task_scores').select('student_id, task_number, points, auto_points').eq('mock_exam_id', ex.id),
        db.from<any[]>('mock_exam_sheets').select('student_id, answers, submitted_at').eq('mock_exam_id', ex.id),
        db.from<any[]>('mock_exam_photos').select('id, student_id, storage_path, file_name, position').eq('mock_exam_id', ex.id),
        db.from<MockExamResultNotifyRow[]>('mock_exam_results').select(RESULT_COLUMNS).eq('mock_exam_id', ex.id),
        db.from<{ answers: (string | null)[] }>('mock_exam_answer_keys').select('answers').eq('mock_exam_id', ex.id).maybeSingle(),
      ])
      if (cancelled) return
      if (sc.error) { setError(sc.error.message || 'Не удалось загрузить баллы'); setLoading(false); return }
      const n = template.max_points.length
      const byId = new Map<string, WorksStudent>()
      for (const g of gs.data ?? []) {
        byId.set(g.student_id, {
          id: g.student_id, name: g.students?.profiles?.full_name || '—', profileId: g.students?.profile_id ?? null,
          points: Array(n).fill(null), auto: Array(n).fill(false), sheet: null, photos: 0, photoList: [], result: null,
        })
      }
      for (const r of sc.data ?? []) {
        const s = byId.get(r.student_id)
        if (!s || r.task_number < 1 || r.task_number > n) continue
        s.points[r.task_number - 1] = Number(r.points)
        s.auto![r.task_number - 1] = r.auto_points != null && Number(r.auto_points) === Number(r.points)
      }
      for (const r of sh.data ?? []) {
        const s = byId.get(r.student_id)
        if (s) s.sheet = { answers: r.answers ?? [], submitted_at: r.submitted_at ?? null }
      }
      for (const p of (ph.data ?? []).slice().sort((a, b) => a.position - b.position)) {
        const s = byId.get(p.student_id)
        if (!s) continue
        s.photoList.push({ id: p.id, storage_path: p.storage_path, file_name: p.file_name, position: p.position })
        s.photos = s.photoList.length
      }
      for (const r of rs.data ?? []) {
        const s = byId.get(r.student_id)
        if (s) s.result = r
      }
      // Алфавит — как в таблице §218 и в журнале преподавателя.
      const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      setExam(ex)
      setStudents(list)
      setKey(k.data?.answers ?? null)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [examId, tick])

  /** Баллы одного ученика — строкой целиком, существующей `save_mock_exam_grid`. */
  const saveRow = useCallback(async (studentId: string, points: (number | null)[]): Promise<{ error: string | null }> => {
    if (!exam) return { error: 'Пробник не загружен' }
    const { error: err } = await db.rpc('save_mock_exam_grid', {
      p_mock_exam_id: exam.id,
      p_rows: [{ student_id: studentId, points }],
    })
    if (err) return { error: err.message || 'Не удалось сохранить' }
    return { error: null }
  }, [exam])

  /** «Уведомить» одному / выбранным (§219). Кому этот итог уже отправлен, база второй раз не шлёт. */
  const notify = useCallback(async (studentIds: string[]): Promise<{ error: string | null; summary: NotifySummary | null }> => {
    if (!exam) return { error: 'Пробник не загружен', summary: null }
    const { data, error: err } = await db.rpc<NotifySummary>('notify_mock_exam_results', {
      p_mock_exam_id: exam.id,
      p_student_ids: studentIds,
    })
    if (err) return { error: err.message || 'Не удалось отправить', summary: null }
    return { error: null, summary: data }
  }, [exam])

  return { exam, students, key, loading, error, reload, saveRow, notify }
}
