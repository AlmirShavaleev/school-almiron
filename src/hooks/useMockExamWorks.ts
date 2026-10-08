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
 *
 * §270. Вместе с баллами читается комментарий преподавателя к номеру
 * (`mock_exam_task_scores.comment`); пишет его `save_mock_exam_task_comments`
 * — после баллов, только в номера с баллом. До миграции §270 колонки нет:
 * баллы читаются без неё, `commentsReady` = false — экран поле не показывает.
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

export interface WorksPhoto { id: string; storage_path: string; file_name: string; position: number; mime_type?: string | null }

/** §229. Вариант пробника глазами персонала — с ключом и всеми файлами (критерии — только персоналу). */
export interface WorksVariant {
  id: string
  position: number
  label: string | null
  condition_path: string | null
  solution_path: string | null
  criteria_path: string | null
  key: (string | null)[] | null
}

export interface WorksStudent extends WorkInput {
  photoList: WorksPhoto[]
  /**
   * §229. Вариант ученика: выданный, а без выдачи — первый по номеру (то же
   * правило, что у базы, `mock_exam_student_variant`). null — у пробника нет
   * строк вариантов (живёт по-старому: ключ и файлы — пробника).
   */
  variant?: WorksVariant | null
  /**
   * §230. Вариант выдан (строка `mock_exam_variant_students`), а не «первый по
   * умолчанию». Невыданный ученику ещё неизвестен: при первом входе база даст
   * наименее занятый, не обязательно первый, — метку «Работы» не ставят.
   */
  variantAssigned?: boolean
  /**
   * §270. Сохранённые комментарии ученику по номерам (как points: индекс —
   * номер − 1); null — нет. Бывают только у номеров второй части с баллом.
   */
  comments: (string | null)[]
}

const RESULT_COLUMNS = 'student_id, score, part1_score, part2_score, notified_at, notified_score, notified_part1_score, notified_part2_score'

export function useMockExamWorks(examId: string | undefined) {
  const [exam, setExam] = useState<WorksExam | null>(null)
  const [students, setStudents] = useState<WorksStudent[]>([])
  const [key, setKey] = useState<(string | null)[] | null>(null)
  /** §229. Варианты пробника по номеру; пусто — пробник без вариантов (или база до §229). */
  const [variants, setVariants] = useState<WorksVariant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** §270. В базе есть колонка комментариев (миграция §270 применена). */
  const [commentsReady, setCommentsReady] = useState(false)
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
        setExam(ex); setStudents([]); setKey(null); setVariants([]); setLoading(false)
        return
      }
      // Первая часть законченных бланков — по ключу, до чтения баллов (как у таблицы §221).
      if (win) {
        try { await db.rpc('grade_mock_exam_part1', { p_mock_exam_id: ex.id }) } catch { /* таблица работает и без этого */ }
        if (cancelled) return
      }
      const [gs, sc, sh, ph, rs, k, vv, vk, va] = await Promise.all([
        db.from<any[]>('group_students').select('student_id, students(id, profile_id, profiles(full_name))').eq('group_id', ex.group_id),
        db.from<any[]>('mock_exam_task_scores').select('student_id, task_number, points, auto_points, comment').eq('mock_exam_id', ex.id),
        db.from<any[]>('mock_exam_sheets').select('student_id, answers, submitted_at').eq('mock_exam_id', ex.id),
        db.from<any[]>('mock_exam_photos').select('id, student_id, storage_path, file_name, position, mime_type').eq('mock_exam_id', ex.id),
        db.from<MockExamResultNotifyRow[]>('mock_exam_results').select(RESULT_COLUMNS).eq('mock_exam_id', ex.id),
        db.from<{ answers: (string | null)[] }>('mock_exam_answer_keys').select('answers').eq('mock_exam_id', ex.id).maybeSingle(),
        // §229. Варианты, их ключи и выдача. До миграции таблиц нет — ошибка
        // значит «вариантов нет», экран живёт как в §228.
        db.from<any[]>('mock_exam_variants').select('id, position, label, condition_path, solution_path, criteria_path').eq('mock_exam_id', ex.id),
        db.from<any[]>('mock_exam_variant_keys').select('variant_id, answers').eq('mock_exam_id', ex.id),
        db.from<any[]>('mock_exam_variant_students').select('student_id, variant_id').eq('mock_exam_id', ex.id),
      ])
      if (cancelled) return
      // §270. До миграции колонки comment нет — баллы читаем без неё.
      let scores = sc
      let withComments = !sc.error
      if (sc.error) {
        scores = await db.from<any[]>('mock_exam_task_scores').select('student_id, task_number, points, auto_points').eq('mock_exam_id', ex.id)
        if (cancelled) return
        withComments = false
      }
      if (scores.error) { setError(scores.error.message || 'Не удалось загрузить баллы'); setLoading(false); return }
      const n = template.max_points.length
      const byId = new Map<string, WorksStudent>()
      for (const g of gs.data ?? []) {
        byId.set(g.student_id, {
          id: g.student_id, name: g.students?.profiles?.full_name || '—', profileId: g.students?.profile_id ?? null,
          points: Array(n).fill(null), auto: Array(n).fill(false), comments: Array(n).fill(null), sheet: null, photos: 0, photoList: [], result: null,
        })
      }
      for (const r of scores.data ?? []) {
        const s = byId.get(r.student_id)
        if (!s || r.task_number < 1 || r.task_number > n) continue
        s.points[r.task_number - 1] = Number(r.points)
        s.auto![r.task_number - 1] = r.auto_points != null && Number(r.auto_points) === Number(r.points)
        s.comments[r.task_number - 1] = typeof r.comment === 'string' && r.comment.trim() ? r.comment : null
      }
      for (const r of sh.data ?? []) {
        const s = byId.get(r.student_id)
        if (s) s.sheet = { answers: r.answers ?? [], submitted_at: r.submitted_at ?? null }
      }
      for (const p of (ph.data ?? []).slice().sort((a, b) => a.position - b.position)) {
        const s = byId.get(p.student_id)
        if (!s) continue
        s.photoList.push({ id: p.id, storage_path: p.storage_path, file_name: p.file_name, position: p.position, mime_type: p.mime_type ?? null })
        s.photos = s.photoList.length
      }
      for (const r of rs.data ?? []) {
        const s = byId.get(r.student_id)
        if (s) s.result = r
      }
      const vKeys = new Map((vk.error ? [] : vk.data ?? []).map(r => [r.variant_id as string, r.answers as (string | null)[]]))
      const vList: WorksVariant[] = (vv.error ? [] : vv.data ?? [])
        .map(r => ({
          id: r.id, position: Number(r.position), label: r.label ?? null,
          condition_path: r.condition_path ?? null, solution_path: r.solution_path ?? null, criteria_path: r.criteria_path ?? null,
          key: vKeys.get(r.id) ?? null,
        }))
        .sort((a, b) => a.position - b.position)
      if (vList.length) {
        const vById = new Map(vList.map(v => [v.id, v]))
        const assigned = new Map((va.error ? [] : va.data ?? []).map(r => [r.student_id as string, r.variant_id as string]))
        for (const s of byId.values()) {
          const own = vById.get(assigned.get(s.id) ?? '')
          s.variant = own ?? vList[0]
          s.variantAssigned = !!own
        }
      }
      // Алфавит — как в таблице §218 и в журнале преподавателя.
      const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      setExam(ex)
      setStudents(list)
      setVariants(vList)
      setKey(k.data?.answers ?? null)
      setCommentsReady(withComments)
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

  /**
   * §270. Комментарии ученику по номерам второй части — `save_mock_exam_task_comments`:
   * `{ "14": "текст", "15": null }` (null или пустой — убрать). Только номера,
   * у которых балл уже сохранён: без строки балла база отвечает «сначала поставьте балл».
   */
  const saveComments = useCallback(async (studentId: string, comments: Record<string, string | null>): Promise<{ error: string | null }> => {
    if (!exam) return { error: 'Пробник не загружен' }
    if (Object.keys(comments).length === 0) return { error: null }
    const { error: err } = await db.rpc('save_mock_exam_task_comments', {
      p_mock_exam_id: exam.id,
      p_student_id: studentId,
      p_comments: comments,
    })
    if (err) return { error: err.message || 'Не удалось сохранить комментарии' }
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

  return { exam, students, key, variants, loading, error, reload, saveRow, saveComments, commentsReady, notify }
}
