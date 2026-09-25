import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { MockExamResultNotifyRow, NotifySummary } from '@/lib/mockExamNotify'

/**
 * §218. Данные экрана «пробник по номерам»: пробник, его шаблон, ученики
 * группы и уже введённые баллы по заданиям; сохранение — одной функцией
 * базы `save_mock_exam_grid` (задания и итоги в одной транзакции).
 *
 * Новых таблиц в сгенерированных типах нет (миграция не применена, типы
 * руками не дописываем — CLAUDE.md), поэтому обращение идёт через узкий
 * вид клиента, как в §215–§217.
 *
 * §219. Сохранение — черновик: никому ничего не шлёт. Уведомляет только
 * `notify` (кнопки «Уведомить» / «Уведомить всех»), через
 * `notify_mock_exam_results`. Для кнопок хук держит сохранённые итоги с
 * отметкой «что и когда отправлено» (`mock_exam_results.notified_*`).
 */

const RESULT_COLUMNS = 'student_id, score, part1_score, part2_score, notified_at, notified_score, notified_part1_score, notified_part2_score'

export interface MockExamTemplate {
  id: string
  title: string
  subject: string
  exam_type: string
  year: number
  max_points: number[]
  part1_last: number
  score_scale: number[] | null
}

export interface GridStudent { id: string; profileId: string | null; name: string }

export interface GridExam {
  id: string
  title: string
  date: string
  subject: string
  exam_type: string
  group_id: string | null
  groupName: string | null
  template: MockExamTemplate | null
}

type Resp<T> = Promise<{ data: T | null; error: { message?: string; code?: string } | null }>
interface Chain<T> extends PromiseLike<{ data: T | null; error: { message?: string } | null }> {
  select(columns: string): Chain<T>
  eq(column: string, value: string): Chain<T>
  maybeSingle(): Resp<T>
}
interface DbLike {
  from<T = unknown>(table: string): Chain<T>
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Resp<T>
}
const db = supabase as unknown as DbLike

export function useMockExamGrid(examId: string | undefined) {
  const [exam, setExam] = useState<GridExam | null>(null)
  const [students, setStudents] = useState<GridStudent[]>([])
  /** points[s][t] — сохранённое; null — клетка пустая («нет данных»). */
  const [points, setPoints] = useState<(number | null)[][]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  /** Сохранённые итоги по student_id — с отметкой об отправке. */
  const [results, setResults] = useState<Record<string, MockExamResultNotifyRow>>({})
  /**
   * Итоги не прочитались. Таблицу это не ломает (баллы по заданиям свои), но
   * кнопки уведомлений без этих данных вести себя честно не могут — экран
   * их гасит и говорит почему. Так же выглядит ветка, влитая раньше
   * PENDING_219.sql: колонок notified_* ещё нет.
   */
  const [resultsError, setResultsError] = useState<string | null>(null)

  const loadResults = useCallback(async (id: string) => {
    const { data, error: rErr } = await db
      .from<MockExamResultNotifyRow[]>('mock_exam_results')
      .select(RESULT_COLUMNS)
      .eq('mock_exam_id', id)
    if (rErr) { setResultsError(rErr.message || 'Не удалось загрузить итоги'); return }
    setResultsError(null)
    const map: Record<string, MockExamResultNotifyRow> = {}
    for (const r of data ?? []) map[r.student_id] = r
    setResults(map)
  }, [])

  useEffect(() => {
    if (!examId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      const { data: e, error: eErr } = await db
        .from<Record<string, any>>('mock_exams')
        .select('id, title, date, subject, exam_type, group_id, template_id, groups(name), mock_exam_templates(id, title, subject, exam_type, year, max_points, part1_last, score_scale)')
        .eq('id', examId)
        .maybeSingle()
      if (cancelled) return
      if (eErr || !e) {
        setError(eErr?.message || 'Пробник не найден')
        setLoading(false)
        return
      }
      const t = e.mock_exam_templates
      const template: MockExamTemplate | null = t ? {
        ...t,
        max_points: (t.max_points ?? []).map(Number),
        part1_last: Number(t.part1_last),
        score_scale: t.score_scale ? t.score_scale.map(Number) : null,
      } : null
      const ex: GridExam = {
        id: e.id, title: e.title, date: e.date, subject: e.subject, exam_type: e.exam_type,
        group_id: e.group_id ?? null, groupName: e.groups?.name ?? null, template,
      }

      let roster: GridStudent[] = []
      let pts: (number | null)[][] = []
      if (ex.group_id && template) {
        const [{ data: gs }, { data: scores, error: sErr }] = await Promise.all([
          db.from<any[]>('group_students')
            .select('student_id, students(id, profile_id, profiles(full_name))')
            .eq('group_id', ex.group_id),
          db.from<{ student_id: string; task_number: number; points: number }[]>('mock_exam_task_scores')
            .select('student_id, task_number, points')
            .eq('mock_exam_id', ex.id),
        ])
        if (cancelled) return
        if (sErr) { setError(sErr.message || 'Не удалось загрузить баллы'); setLoading(false); return }
        roster = (gs ?? []).map((g: any) => ({
          id: g.student_id,
          profileId: g.students?.profile_id ?? null,
          name: g.students?.profiles?.full_name || '—',
        }))
        // Алфавит — как в журнале Excel у преподавателя: иначе вставка
        // «без фамилий» от клетки разливалась бы по случайному порядку.
        roster.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        const at = new Map(roster.map((s, i) => [s.id, i]))
        pts = roster.map(() => template.max_points.map(() => null))
        for (const r of scores ?? []) {
          const s = at.get(r.student_id)
          if (s == null || r.task_number < 1 || r.task_number > template.max_points.length) continue
          pts[s][r.task_number - 1] = Number(r.points)
        }
      }
      if (ex.group_id && template) await loadResults(ex.id)
      if (cancelled) return
      setExam(ex)
      setStudents(roster)
      setPoints(pts)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [examId, tick, loadResults])

  /**
   * Всё или ничего: одна RPC пишет и баллы по заданиям, и итоги. Никого НЕ
   * уведомляет (§219): преподаватель сохраняет сколько угодно раз, пока
   * проверяет, а отправляет, когда готов, — кнопкой.
   */
  const save = useCallback(async (next: (number | null)[][]): Promise<{ error: string | null }> => {
    if (!exam?.template) return { error: 'У пробника нет шаблона' }
    const p_rows = students.map((s, i) => ({ student_id: s.id, points: next[i] }))
    const { error: rpcErr } = await db.rpc('save_mock_exam_grid', {
      p_mock_exam_id: exam.id,
      p_rows,
    })
    if (rpcErr) return { error: rpcErr.message || 'Не удалось сохранить' }
    setPoints(next)
    await loadResults(exam.id)
    return { error: null }
  }, [exam, students, loadResults])

  /**
   * Отправить результат: `studentIds = null` — «Уведомить всех», иначе —
   * выбранным. Кому этот итог уже отправлен, база второй раз не шлёт.
   */
  const notify = useCallback(async (studentIds: string[] | null): Promise<{ error: string | null; summary: NotifySummary | null }> => {
    if (!exam) return { error: 'Пробник не загружен', summary: null }
    const { data, error: rpcErr } = await db.rpc<NotifySummary>('notify_mock_exam_results', {
      p_mock_exam_id: exam.id,
      p_student_ids: studentIds,
    })
    if (rpcErr) return { error: rpcErr.message || 'Не удалось отправить', summary: null }
    await loadResults(exam.id)
    return { error: null, summary: data }
  }, [exam, loadResults])

  const reload = useCallback(() => setTick(t => t + 1), [])

  return { exam, students, points, results, resultsError, loading, error, save, notify, reload }
}
