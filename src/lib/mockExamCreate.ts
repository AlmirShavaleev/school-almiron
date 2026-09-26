import { supabase } from '@/lib/supabase'
import { uploadToStorage } from '@/lib/storageUpload'
import { MOCK_EXAMS_BUCKET } from '@/lib/mockExamLesson'
import { VARIANT_LABEL_MAX, variantFilePath, type VariantFileKind, type VariantMode } from '@/lib/mockExamVariants'
import type { MockExamTemplate } from '@/hooks/useMockExamGrid'

/**
 * §228. «Назначить пробник» из формы «Новый пробник».
 *
 * Отмечено N групп → N пробников, по одному на группу, с одинаковыми
 * названием, шаблоном, временем и длительностью (решение оркестратора,
 * владелец не возразил). У каждой группы своя таблица баллов, свои работы и
 * свои уведомления — поэтому отдельные строки `mock_exams`, а не одна на все.
 *
 * Порядок:
 *  1. все строки — ОДНОЙ вставкой (одна транзакция: либо все группы, либо ни
 *     одной — не бывает «11А назначен, 11Б нет» из-за сбоя посередине);
 *  2. §229: варианты — одной вставкой, у каждого пробника свои строки;
 *  3. условие, решение, критерии — в папку варианта КАЖДОГО пробника
 *     (`<пробник>/v<N>/condition|solution|criteria/…`): политика чтения
 *     `mock_exam_file_readable` пускает ученика только к файлу своего
 *     пробника и своего варианта. Первому — загрузка, остальным — копия
 *     внутри хранилища, а если копия не удалась — повторная загрузка;
 *  4. ключ — `save_mock_exam_variant_key` каждому варианту каждого пробника;
 *  5. раздача «кому какой» — внутри каждой группы.
 * Сбой в шагах 2–3 пробники не откатывает: они уже созданы и видны, а что не
 * получилось — возвращается словами, чтобы дозагрузить во вкладке «Настройка».
 */

export interface CreateVariantInput {
  condition: File | null
  solution: File | null
  criteria: File | null
  /** Ключ первой части; все пустые — не сохраняется. */
  key: string[]
  /** §230. Подпись («Вариант А», «Резерв»); пусто — «Вариант N». Пишется только при нескольких вариантах. */
  label?: string | null
}

export interface CreateInput {
  title: string
  template: MockExamTemplate
  groups: { id: string; name: string }[]
  /** Момент начала; null — черновик (ученики не видят). */
  startsAt: string | null
  /** Задуманный момент черновика — пишется в `date`, чтобы форма его помнила. */
  plannedAt: string | null
  durationMinutes: number
  /** §229. Варианты по порядку: [0] — вариант 1. Один вариант — пробник как в §228. */
  variants: CreateVariantInput[]
  /** §229. Как раздали — только для экрана «Настройка». */
  variantMode: VariantMode
  /**
   * §229. Кому какой вариант, по группам: `{ группа: { ученик: номер } }`.
   * Раздача внутри каждой группы. Кого здесь нет — получит наименее занятый
   * вариант при первом заходе (это делает база).
   */
  assignments: Record<string, Record<string, number>>
  profileId: string
}

export interface CreateResult {
  created: { id: string; groupId: string; groupName: string }[]
  problems: string[]
  error: string | null
}

type Res<T> = { data: T | null; error: { message?: string } | null }
interface Chain<T> extends PromiseLike<Res<T>> {
  select(columns: string): Chain<T>
  eq(column: string, value: string): Chain<T>
  insert(rows: unknown): Chain<T>
  update(row: unknown): Chain<T>
  maybeSingle(): PromiseLike<Res<T>>
}
interface DbLike {
  from<T = unknown>(table: string): Chain<T>
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): PromiseLike<Res<T>>
}
const db = supabase as unknown as DbLike

const KINDS: { kind: VariantFileKind; file: (v: CreateVariantInput) => File | null; label: string }[] = [
  { kind: 'condition', file: v => v.condition, label: 'Условие' },
  { kind: 'solution', file: v => v.solution, label: 'Решение' },
  { kind: 'criteria', file: v => v.criteria, label: 'Критерии' },
]

export async function createMockExams(input: CreateInput): Promise<CreateResult> {
  const { template } = input
  // §219: строка `teachers` — по профилю при ЛЮБОЙ роли (у владельца роль admin, а строка есть).
  const { data: tc } = await db.from<{ id: string }>('teachers').select('id').eq('profile_id', input.profileId).maybeSingle()
  const maxScore = template.score_scale?.length
    ? template.score_scale[template.score_scale.length - 1]
    : template.max_points.reduce((a, b) => a + b, 0)
  const date = input.startsAt ?? input.plannedAt ?? new Date().toISOString()
  const multi = input.variants.length > 1
  const rows = input.groups.map(g => ({
    title: input.title.trim(),
    subject: template.subject,
    exam_type: template.exam_type,
    date,
    group_id: g.id,
    template_id: template.id,
    // max_score база перепишет из шаблона (триггер mock_exams_template_guard, §218).
    max_score: maxScore,
    created_by: tc?.id ?? null,
    starts_at: input.startsAt,
    duration_minutes: input.durationMinutes,
    ...(multi ? { variant_mode: input.variantMode } : {}),
  }))
  const { data, error } = await db.from<{ id: string; group_id: string }[]>('mock_exams').insert(rows).select('id, group_id')
  if (error || !data) return { created: [], problems: [], error: error?.message || 'Пробник не создан' }
  const created = input.groups.map((g, i) => {
    const row = data.find(r => r.group_id === g.id) ?? data[i]
    return { id: row.id, groupId: g.id, groupName: g.name }
  })

  const problems: string[] = []
  // §229. Варианты — одной вставкой на все пробники: у каждого пробника свои строки.
  const labelOf = (k: number): string | null => (multi ? (input.variants[k].label ?? '').replace(/\s+/g, ' ').trim().slice(0, VARIANT_LABEL_MAX) || null : null)
  const vRows = created.flatMap(c => input.variants.map((_, k) => ({
    mock_exam_id: c.id, position: k + 1, ...(labelOf(k) ? { label: labelOf(k) } : {}),
  })))
  const { data: vData, error: vErr } = await db.from<{ id: string; mock_exam_id?: string; position?: number }[]>('mock_exam_variants')
    .insert(vRows).select('id, mock_exam_id, position')
  if (vErr || !vData) {
    problems.push(`Варианты не созданы: ${vErr?.message || 'ошибка'} — добавьте их во вкладке «Настройка»`)
    return { created, problems, error: null }
  }
  const variantId = (examId: string, position: number): string | null => {
    const i = vRows.findIndex(r => r.mock_exam_id === examId && r.position === position)
    const hit = vData.find(r => r.mock_exam_id === examId && Number(r.position) === position) ?? vData[i]
    return hit?.id ?? null
  }
  const vName = (k: number) => (multi ? `${labelOf(k) ?? `вариант ${k + 1}`}, ` : '')

  // Файлы: в папку варианта КАЖДОГО пробника — первому загрузка, остальным копия.
  for (let k = 0; k < input.variants.length; k++) {
    for (const { kind, file: pick, label } of KINDS) {
      const file = pick(input.variants[k])
      if (!file) continue
      let source: string | null = null
      for (const c of created) {
        const vid = variantId(c.id, k + 1)
        if (!vid) continue
        const path = variantFilePath(c.id, k + 1, kind, file.name)
        let ok = false
        if (source) {
          const cp = await supabase.storage.from(MOCK_EXAMS_BUCKET).copy(source, path)
          ok = !cp.error
        }
        if (!ok) {
          try { await uploadToStorage(MOCK_EXAMS_BUCKET, path, file); ok = true } catch (e) {
            problems.push(`${label} (${vName(k)}группа ${c.groupName}) не загрузилось: ${e instanceof Error ? e.message : 'ошибка'}`)
          }
        }
        if (!ok) continue
        source = source ?? path
        const up = await db.from('mock_exam_variants').update({ [`${kind}_path`]: path }).eq('id', vid)
        if (up.error) problems.push(`${label} (${vName(k)}группа ${c.groupName}) не привязалось: ${up.error.message || 'ошибка'}`)
      }
    }
  }

  for (let k = 0; k < input.variants.length; k++) {
    const key = input.variants[k].key
    if (!key.some(a => a.trim())) continue
    for (const c of created) {
      const vid = variantId(c.id, k + 1)
      if (!vid) continue
      const { error: kErr } = await db.rpc('save_mock_exam_variant_key', { p_variant_id: vid, p_answers: key })
      if (kErr) problems.push(`Ключ (${vName(k)}группа ${c.groupName}) не сохранён: ${kErr.message || 'ошибка'}`)
    }
  }

  // Раздача — внутри каждой группы. Один вариант — раздавать нечего: база
  // выдаст его каждому при первом заходе.
  if (multi) {
    for (const c of created) {
      const byStudent = input.assignments[c.groupId] ?? {}
      const aRows = Object.entries(byStudent)
        .map(([sid, pos]) => ({ mock_exam_id: c.id, student_id: sid, variant_id: variantId(c.id, pos) }))
        .filter(r => r.variant_id)
      if (aRows.length === 0) continue
      const { error: aErr } = await db.from('mock_exam_variant_students').insert(aRows)
      if (aErr) problems.push(`Варианты ученикам группы ${c.groupName} не разданы: ${aErr.message || 'ошибка'} — ученики получат их при входе`)
    }
  }
  return { created, problems, error: null }
}
