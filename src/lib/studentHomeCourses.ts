/**
 * Главная ученика «без шума» (письмо главная_ученика_без_шума.md, 14.10.2026):
 * карточка курса — общий % и полоски по разделам, «Продолжить урок».
 *
 * Источник — одна RPC на все курсы ученика, `student_home_courses()`
 * (миграция 20261013214307). % раздела — доля тем раздела С ДЗ, у которых ДЗ
 * сдано или принято (решает принятая попытка, иначе свежая, как в журнале).
 * «Продолжить» — следующая открытая тема с опубликованным ДЗ, ещё не сданным.
 * Здесь только типы и чистые преобразования; сеть — в useStudentHomeCourses.
 */

export interface HomeModule {
  moduleId: string
  title: string
  done: number
  total: number
  percent: number
}

export interface HomeContinue {
  topicId: string
  title: string
  moduleTitle: string | null
}

export interface HomeCourseProgress {
  courseId: string
  done: number
  total: number
  percent: number
  modules: HomeModule[]
  next: HomeContinue | null
}

export function percentOf(done: number, total: number): number {
  return total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const str = (v: unknown) => (typeof v === 'string' ? v : null)

/**
 * Ответ RPC → типы. Неполный или чужой формат не роняет главную: битые
 * элементы пропускаются, не-массив — пустой список.
 */
export function normalizeHomeCourses(raw: unknown): HomeCourseProgress[] {
  if (!Array.isArray(raw)) return []
  const out: HomeCourseProgress[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const courseId = str(o.course_id)
    if (!courseId) continue
    const modules: HomeModule[] = (Array.isArray(o.modules) ? o.modules : [])
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && !!str((m as Record<string, unknown>).module_id))
      .map(m => {
        const done = num(m.done), total = num(m.total)
        return { moduleId: str(m.module_id)!, title: str(m.title) ?? 'Раздел', done, total, percent: percentOf(done, total) }
      })
    const c = o.continue as Record<string, unknown> | null | undefined
    const next = c && str(c.topic_id) ? { topicId: str(c.topic_id)!, title: str(c.title) ?? 'Следующая тема', moduleTitle: str(c.module_title) } : null
    const done = num(o.topics_done), total = num(o.topics_total)
    out.push({ courseId, done, total, percent: percentOf(done, total), modules, next })
  }
  return out
}

/** Куда ведёт «Продолжить»: в тему, если она есть, иначе — в курс. */
export function continueHref(groupId: string, next: HomeContinue | null): string {
  return next ? `/my-course/${groupId}/topic/${next.topicId}` : `/my-course/${groupId}`
}

/**
 * Большая кнопка «Продолжить урок» наверху — одна на главную: первый по
 * порядку курс ученика, у которого есть следующая тема.
 */
export function primaryContinue<C extends { courseId: string; groupId: string; courseTitle: string }>(
  courses: readonly C[],
  progress: readonly HomeCourseProgress[],
): { course: C; next: HomeContinue } | null {
  const byId = new Map(progress.map(p => [p.courseId, p]))
  for (const course of courses) {
    const next = byId.get(course.courseId)?.next
    if (next) return { course, next }
  }
  return null
}
