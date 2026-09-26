import { supabase } from '@/lib/supabase'
import { previewMockRows, type MockLessonListRow, type MockScheduleRow } from '@/lib/mockExamLesson'

/**
 * §224.2. Пробники группы для ученика — одно место, откуда их берут все
 * экраны: страница курса, страница темы, «Мои курсы», кабинет.
 *
 * Ученик: RPC `my_mock_exams(группа)` (§221/§224) — окно, свой бланк, итог.
 * Предпросмотр персонала: та же RPC вернула бы пустоту, поэтому — строки
 * `mock_exams` под RLS персонала и окно по расписанию (`previewMockRows`).
 *
 * Ошибки глотаются: до миграции или при сбое экран должен рисоваться как
 * раньше, просто без пробников (§221).
 */

// Типы базы не перегенерированы после §221 — RPC и колонки окна через `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export async function loadMyMockExams(groupId: string): Promise<MockLessonListRow[]> {
  try {
    const { data, error } = await db.rpc('my_mock_exams', { p_group_id: groupId })
    if (error) throw new Error(error.message ?? 'Не удалось загрузить пробники')
    return (Array.isArray(data) ? data : []) as MockLessonListRow[]
  } catch (e) {
    console.warn('Не удалось загрузить пробники группы', e)
    return []
  }
}

export async function loadPreviewMockExams(groupIds: string[]): Promise<Record<string, MockLessonListRow[]>> {
  const out: Record<string, MockLessonListRow[]> = {}
  for (const g of groupIds) out[g] = []
  if (groupIds.length === 0) return out
  try {
    const { data, error } = await db.from('mock_exams')
      .select('id, title, group_id, starts_at, duration_minutes, photo_grace_minutes')
      .in('group_id', groupIds)
    if (error) throw new Error(error.message ?? 'Не удалось загрузить пробники')
    const rows = (data ?? []) as MockScheduleRow[]
    const now = Date.now()
    for (const g of groupIds) out[g] = previewMockRows(rows.filter(r => r.group_id === g), now)
  } catch (e) {
    console.warn('Не удалось загрузить пробники для предпросмотра', e)
  }
  return out
}

/** Пробники нескольких групп: ученику — по RPC на группу (групп единицы). */
export async function loadMockExamsByGroup(groupIds: string[], preview: boolean): Promise<Record<string, MockLessonListRow[]>> {
  if (preview) return loadPreviewMockExams(groupIds)
  const lists = await Promise.all(groupIds.map(g => loadMyMockExams(g)))
  return Object.fromEntries(groupIds.map((g, i) => [g, lists[i]]))
}
