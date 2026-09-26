import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { uploadToStorage } from '@/lib/storageUpload'
import { MOCK_EXAMS_BUCKET, mockExamFilePath } from '@/lib/mockExamLesson'
import { variantFilePath, type VariantFileKind, type VariantMode } from '@/lib/mockExamVariants'

// Типы базы не перегенерированы после §229 — строки новых таблиц через `any` (как в lib/myMockExams).
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * §229. Варианты существующего пробника — для вкладки «Настройка»: варианты с
 * файлами и ключами, кому какой выдан, у кого уже есть бланк или фото (им
 * вариант не сменить — триггер в базе, здесь только чтобы не предлагать
 * заведомый отказ).
 *
 * Пробник без строк вариантов (заведён до §229 и не перенесён, или старым
 * экраном после миграции) живёт как раньше: его «вариант 1» — старые колонки
 * `mock_exams.condition_path/solution_path` и ключ `mock_exam_answer_keys`
 * (`id: null`). Строки вариантов заводятся, только когда без них не обойтись:
 * второй вариант или критерии (у старых колонок критериев нет). Тогда
 * вариант 1 получает те же пути, а ключ — триггером базы.
 *
 * Файлы грузятся сразу (как в §221/§228), ключ и раздача — кнопкой формы.
 */

export interface VariantItem {
  /** null — пробник без строк вариантов, это его старые колонки. */
  id: string | null
  position: number
  label: string | null
  condition_path: string | null
  solution_path: string | null
  criteria_path: string | null
  key: (string | null)[] | null
}

type Res<T> = { data: T | null; error: { message?: string; code?: string } | null }
interface Chain<T> extends PromiseLike<Res<T>> {
  select(columns: string): Chain<T>
  eq(column: string, value: string): Chain<T>
  in(column: string, values: string[]): Chain<T>
  order(column: string, opts?: { ascending?: boolean }): Chain<T>
  insert(rows: unknown): Chain<T>
  update(row: unknown): Chain<T>
  upsert(rows: unknown, opts?: { onConflict?: string }): Chain<T>
  delete(): Chain<T>
  maybeSingle(): PromiseLike<Res<T>>
}
interface DbLike {
  from<T = unknown>(table: string): Chain<T>
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): PromiseLike<Res<T>>
}
const db = supabase as unknown as DbLike

export interface VariantsExam {
  id: string
  group_id: string | null
  condition_path: string | null
  solution_path: string | null
}

export function useMockExamVariants(exam: VariantsExam | null, legacyKey: (string | null)[] | null) {
  const [rows, setRows] = useState<VariantItem[] | null>(null)
  /** Таблиц §229 нет (ветка раньше миграции) — только старый «вариант 1». */
  const [unavailable, setUnavailable] = useState(false)
  const [assign, setAssign] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<VariantMode>('order')
  const [locked, setLocked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const examId = exam?.id

  useEffect(() => {
    if (!examId) return
    let cancelled = false
    ;(async () => {
      const [v, k, a, sh, ph, me] = await Promise.all([
        db.from<any[]>('mock_exam_variants').select('id, position, label, condition_path, solution_path, criteria_path').eq('mock_exam_id', examId).order('position'),
        db.from<any[]>('mock_exam_variant_keys').select('variant_id, answers').eq('mock_exam_id', examId),
        db.from<any[]>('mock_exam_variant_students').select('student_id, variant_id').eq('mock_exam_id', examId),
        db.from<any[]>('mock_exam_sheets').select('student_id').eq('mock_exam_id', examId),
        db.from<any[]>('mock_exam_photos').select('student_id').eq('mock_exam_id', examId),
        db.from<any>('mock_exams').select('variant_mode').eq('id', examId).maybeSingle(),
      ])
      if (cancelled) return
      if (v.error) {
        setUnavailable(true)
        setRows([])
      } else {
        setUnavailable(false)
        const keys = new Map((k.data ?? []).map(r => [r.variant_id as string, r.answers as (string | null)[]]))
        setRows((v.data ?? []).map(r => ({
          id: r.id, position: Number(r.position), label: r.label ?? null,
          condition_path: r.condition_path ?? null, solution_path: r.solution_path ?? null, criteria_path: r.criteria_path ?? null,
          key: keys.get(r.id) ?? null,
        })))
      }
      setAssign(Object.fromEntries((a.data ?? []).map(r => [r.student_id as string, r.variant_id as string])))
      setLocked(new Set([...(sh.data ?? []), ...(ph.data ?? [])].map(r => r.student_id as string)))
      const m = me.data?.variant_mode
      setMode(m === 'random' || m === 'manual' ? m : 'order')
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [examId, tick])

  const virtual = !rows || rows.length === 0
  const legacyCondition = exam?.condition_path ?? null
  const legacySolution = exam?.solution_path ?? null
  const variants: VariantItem[] = useMemo(() => (!rows || rows.length === 0
    ? [{ id: null, position: 1, label: null, condition_path: legacyCondition, solution_path: legacySolution, criteria_path: null, key: legacyKey }]
    : rows), [rows, legacyCondition, legacySolution, legacyKey])

  /** Завести строку варианта 1 из старых колонок, если её ещё нет. */
  const materialize = useCallback(async (): Promise<{ id: string | null; error: string | null }> => {
    if (!exam) return { id: null, error: 'Пробник не загружен' }
    if (rows && rows.length > 0) return { id: rows[0].id, error: null }
    if (unavailable) return { id: null, error: 'Варианты появятся после обновления базы' }
    const { data, error } = await db.from<any[]>('mock_exam_variants')
      .insert([{ mock_exam_id: exam.id, position: 1, condition_path: exam.condition_path, solution_path: exam.solution_path }])
      .select('id')
    if (error || !data?.[0]) return { id: null, error: error?.message || 'Вариант не создан' }
    const id = data[0].id as string
    // Ключ пробника → ключ варианта 1 (база сама положит его и в старую таблицу).
    if (legacyKey && legacyKey.some(x => (x ?? '').trim())) {
      await db.rpc('save_mock_exam_variant_key', { p_variant_id: id, p_answers: legacyKey.map(x => x ?? '') })
    }
    return { id, error: null }
  }, [exam, rows, unavailable, legacyKey])

  const addVariant = useCallback(async (): Promise<{ error: string | null }> => {
    if (!exam) return { error: 'Пробник не загружен' }
    const m = await materialize()
    if (m.error) return { error: m.error }
    const next = Math.max(1, ...variants.map(v => v.position)) + 1
    const { error } = await db.from('mock_exam_variants').insert([{ mock_exam_id: exam.id, position: next }]).select('id')
    if (error) return { error: error.message || 'Вариант не добавлен' }
    reload()
    return { error: null }
  }, [exam, materialize, variants, reload])

  const removeVariant = useCallback(async (item: VariantItem): Promise<{ error: string | null }> => {
    if (!item.id) return { error: null }
    const { error } = await db.from('mock_exam_variants').delete().eq('id', item.id)
    if (error) return { error: error.message || 'Вариант не удалён' }
    const paths = [item.condition_path, item.solution_path, item.criteria_path].filter((p): p is string => !!p && p.includes(`/v${item.position}/`))
    if (paths.length) await supabase.storage.from(MOCK_EXAMS_BUCKET).remove(paths)
    reload()
    return { error: null }
  }, [reload])

  /**
   * Файл варианта: новый объект в бакете, затем путь в варианте, старый объект
   * — прочь. У пробника без строк вариантов условие и решение — по-старому (в
   * колонки пробника), критерии — заводят вариант 1.
   */
  const uploadFile = useCallback(async (item: VariantItem, kind: VariantFileKind, file: File, onProgress?: (p: number) => void): Promise<{ error: string | null }> => {
    if (!exam) return { error: 'Пробник не загружен' }
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return { error: 'Нужен PDF' }
    let id = item.id
    if (!id && kind !== 'criteria') {
      const path = mockExamFilePath(exam.id, kind, file.name)
      try { await uploadToStorage(MOCK_EXAMS_BUCKET, path, file, onProgress) } catch (e) {
        return { error: e instanceof Error ? e.message : 'Не удалось загрузить' }
      }
      const column = kind === 'condition' ? 'condition_path' : 'solution_path'
      const { error } = await db.from('mock_exams').update({ [column]: path }).eq('id', exam.id)
      if (error) { await supabase.storage.from(MOCK_EXAMS_BUCKET).remove([path]); return { error: error.message || 'Не сохранилось' } }
      const old = kind === 'condition' ? exam.condition_path : exam.solution_path
      if (old && old !== path) await supabase.storage.from(MOCK_EXAMS_BUCKET).remove([old])
      reload()
      return { error: null }
    }
    if (!id) {
      const m = await materialize()
      if (m.error || !m.id) return { error: m.error || 'Вариант не создан' }
      id = m.id
    }
    const path = variantFilePath(exam.id, item.position, kind, file.name)
    try { await uploadToStorage(MOCK_EXAMS_BUCKET, path, file, onProgress) } catch (e) {
      return { error: e instanceof Error ? e.message : 'Не удалось загрузить' }
    }
    const column = `${kind}_path`
    const { error } = await db.from('mock_exam_variants').update({ [column]: path }).eq('id', id)
    if (error) { await supabase.storage.from(MOCK_EXAMS_BUCKET).remove([path]); return { error: error.message || 'Не сохранилось' } }
    const old = item[column as 'condition_path']
    // Старый файл убираем, только если он в папке этого варианта: путь §221 мог
    // остаться и в колонке пробника (его читает старый экран).
    if (old && old !== path && old.includes(`/v${item.position}/`)) await supabase.storage.from(MOCK_EXAMS_BUCKET).remove([old])
    reload()
    return { error: null }
  }, [exam, materialize, reload])

  const saveKey = useCallback(async (item: VariantItem, answers: string[]): Promise<{ error: string | null; notCheckable: number[]; changed: number }> => {
    if (!exam) return { error: 'Пробник не загружен', notCheckable: [], changed: 0 }
    const { data, error } = item.id
      ? await db.rpc<{ not_checkable: number[]; grade: { changed_cells: number } }>('save_mock_exam_variant_key', { p_variant_id: item.id, p_answers: answers })
      : await db.rpc<{ not_checkable: number[]; grade: { changed_cells: number } }>('save_mock_exam_key', { p_mock_exam_id: exam.id, p_answers: answers })
    if (error) return { error: error.message || 'Ключ не сохранён', notCheckable: [], changed: 0 }
    return { error: null, notCheckable: data?.not_checkable ?? [], changed: data?.grade?.changed_cells ?? 0 }
  }, [exam])

  /**
   * Раздача: только тем, кому вариант меняется и у кого нет бланка/фото
   * (им база откажет — и откатит всю пачку). Номер → id варианта.
   */
  const saveAssignments = useCallback(async (byStudent: Record<string, number>): Promise<{ error: string | null; changed: number }> => {
    if (!exam) return { error: 'Пробник не загружен', changed: 0 }
    if (virtual) return { error: null, changed: 0 }
    const idByPos = new Map(variants.map(v => [v.position, v.id]))
    const rowsToSave = Object.entries(byStudent)
      .filter(([sid, pos]) => !locked.has(sid) && idByPos.get(pos) && assign[sid] !== idByPos.get(pos))
      .map(([sid, pos]) => ({ mock_exam_id: exam.id, student_id: sid, variant_id: idByPos.get(pos) }))
    if (rowsToSave.length === 0) return { error: null, changed: 0 }
    const { error } = await db.from('mock_exam_variant_students').upsert(rowsToSave, { onConflict: 'mock_exam_id,student_id' })
    if (error) return { error: error.message || 'Раздача не сохранена', changed: 0 }
    reload()
    return { error: null, changed: rowsToSave.length }
  }, [exam, virtual, variants, locked, assign, reload])

  /** Номер варианта по id ученика — из выданного; без выдачи — нет (база выдаст при входе). */
  const positionOf: Record<string, number> = {}
  if (!virtual) {
    const posById = new Map(variants.map(v => [v.id, v.position]))
    for (const [sid, vid] of Object.entries(assign)) {
      const p = posById.get(vid)
      if (p != null) positionOf[sid] = p
    }
  }

  return {
    variants, virtual, unavailable, mode, assigned: positionOf, locked, loading,
    reload, addVariant, removeVariant, uploadFile, saveKey, saveAssignments,
  }
}
