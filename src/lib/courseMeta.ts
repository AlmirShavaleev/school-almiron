/**
 * Общие источники экранов курса ученика в стиле ЛК — «Мои курсы» и страница
 * курса (письма 15.10): одна логика подсчётов на всех экранах.
 *  - публичное название с витрины (`course_showcase`) и режим курса
 *    (`course_unlock_modes`: «по прохождению» / «по расписанию»);
 *  - открытые темы с ДЗ по разделам (`topic_homework` под политикой видимых
 *    тем) — «открыто» в той же единице, что «пройдено N из M»
 *    `student_home_courses()`.
 * Только чтение; сбой — пустые значения, экран цел.
 */
import { supabase } from '@/lib/supabase'

// Узкий тип: таблиц витрины и режима нет в сгенерированных типах (они отстают
// от базы и руками не дописываются — CLAUDE.md).
type Rows = PromiseLike<{ data: Array<Record<string, unknown>> | null; error: unknown }>
type Q = Rows & { in: (c: string, v: string[]) => Q; eq: (c: string, v: unknown) => Q }
type Db = { from: (t: string) => { select: (c: string) => Q } }

export interface CourseExtras {
  showcase: Map<string, string>
  progressMode: Set<string>
}

export async function loadCourseExtras(courseIds: string[]): Promise<CourseExtras> {
  const db = supabase as unknown as Db
  const [show, modes] = await Promise.all([
    db.from('course_showcase').select('course_id, title').in('course_id', courseIds).eq('is_active', true),
    db.from('course_unlock_modes').select('course_id, mode').in('course_id', courseIds),
  ])
  return {
    showcase: new Map(((show.error ? [] : show.data) ?? []).map(r => [String(r.course_id), String(r.title)])),
    progressMode: new Set(((modes.error ? [] : modes.data) ?? []).filter(r => r.mode === 'progress').map(r => String(r.course_id))),
  }
}

/**
 * Открытые темы с ДЗ по разделам — для кольца «открыто» и лестницы (письмо
 * ЛК_стиль_мои_курсы_прогресс_Б.md). Ученик читает `topic_homework` только
 * под политикой `topic_homework_student_select` — опубликованные ДЗ тем,
 * открытых ему сейчас (`student_visible_topics()`: по датам или «по
 * прохождению», с учётом подписки). Темы с ДЗ — та же единица, что
 * «пройдено N из M» в `student_home_courses`. Сбой — null: «открыто» не
 * показываем, а не показываем неправду.
 */
export async function loadOpenByModule(): Promise<Map<string, number> | null> {
  try {
    const { data, error } = await supabase.from('topic_homework').select('topic_id, topic:topics!inner(module_id)')
    if (error) return null
    const topics = new Map<string, Set<string>>()
    for (const r of (data ?? []) as unknown as Array<{ topic_id: string; topic: { module_id: string } | null }>) {
      if (!r.topic?.module_id) continue
      if (!topics.has(r.topic.module_id)) topics.set(r.topic.module_id, new Set())
      topics.get(r.topic.module_id)!.add(r.topic_id)
    }
    return new Map([...topics].map(([m, set]) => [m, set.size]))
  } catch {
    return null
  }
}
