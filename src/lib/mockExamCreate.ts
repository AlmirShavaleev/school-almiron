import { supabase } from '@/lib/supabase'
import { uploadToStorage } from '@/lib/storageUpload'
import { MOCK_EXAMS_BUCKET, mockExamFilePath } from '@/lib/mockExamLesson'
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
 *  2. условие и решение — в папку КАЖДОГО пробника (`<пробник>/condition|solution/…`):
 *     политика чтения `mock_exam_file_readable` пускает ученика только к
 *     файлу, в пути которого id его пробника. Первому — загрузка, остальным —
 *     копия внутри хранилища, а если копия не удалась — повторная загрузка;
 *  3. ключ — `save_mock_exam_key` каждому.
 * Сбой в шагах 2–3 пробники не откатывает: они уже созданы и видны, а что не
 * получилось — возвращается словами, чтобы дозагрузить во вкладке «Настройка».
 */

export interface CreateInput {
  title: string
  template: MockExamTemplate
  groups: { id: string; name: string }[]
  /** Момент начала; null — черновик (ученики не видят). */
  startsAt: string | null
  /** Задуманный момент черновика — пишется в `date`, чтобы форма его помнила. */
  plannedAt: string | null
  durationMinutes: number
  condition: File | null
  solution: File | null
  /** Ключ первой части; все пустые — не сохраняется. */
  key: string[]
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

export async function createMockExams(input: CreateInput): Promise<CreateResult> {
  const { template } = input
  // §219: строка `teachers` — по профилю при ЛЮБОЙ роли (у владельца роль admin, а строка есть).
  const { data: tc } = await db.from<{ id: string }>('teachers').select('id').eq('profile_id', input.profileId).maybeSingle()
  const maxScore = template.score_scale?.length
    ? template.score_scale[template.score_scale.length - 1]
    : template.max_points.reduce((a, b) => a + b, 0)
  const date = input.startsAt ?? input.plannedAt ?? new Date().toISOString()
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
  }))
  const { data, error } = await db.from<{ id: string; group_id: string }[]>('mock_exams').insert(rows).select('id, group_id')
  if (error || !data) return { created: [], problems: [], error: error?.message || 'Пробник не создан' }
  const created = input.groups.map((g, i) => {
    const row = data.find(r => r.group_id === g.id) ?? data[i]
    return { id: row.id, groupId: g.id, groupName: g.name }
  })

  const problems: string[] = []
  for (const kind of ['condition', 'solution'] as const) {
    const file = kind === 'condition' ? input.condition : input.solution
    if (!file) continue
    const label = kind === 'condition' ? 'Условие' : 'Решение'
    let source: string | null = null
    for (const c of created) {
      const path = mockExamFilePath(c.id, kind, file.name)
      let ok = false
      if (source) {
        const cp = await supabase.storage.from(MOCK_EXAMS_BUCKET).copy(source, path)
        ok = !cp.error
      }
      if (!ok) {
        try { await uploadToStorage(MOCK_EXAMS_BUCKET, path, file); ok = true } catch (e) {
          problems.push(`${label} для группы ${c.groupName} не загрузилось: ${e instanceof Error ? e.message : 'ошибка'}`)
        }
      }
      if (!ok) continue
      source = source ?? path
      const column = kind === 'condition' ? 'condition_path' : 'solution_path'
      const up = await db.from('mock_exams').update({ [column]: path }).eq('id', c.id)
      if (up.error) problems.push(`${label} для группы ${c.groupName} не привязалось: ${up.error.message || 'ошибка'}`)
    }
  }

  if (input.key.some(a => a.trim())) {
    for (const c of created) {
      const { error: kErr } = await db.rpc('save_mock_exam_key', { p_mock_exam_id: c.id, p_answers: input.key })
      if (kErr) problems.push(`Ключ для группы ${c.groupName} не сохранён: ${kErr.message || 'ошибка'}`)
    }
  }
  return { created, problems, error: null }
}
