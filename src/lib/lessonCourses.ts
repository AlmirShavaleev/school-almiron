/**
 * «Урочный» курс ученика — курс из раздела «Мой курс», где ДЗ живут внутри
 * уроков.
 *
 * 13.10 владелец: «с аккаунта ученика убрать ссылки на ДЗ в моём курсе» — ДЗ
 * таких курсов убрали со всех списков (их было 73 на курс, «Не сдано: 102»).
 * 15.10 уточнение (письмо меню_ученика_задания_только_открытые_уроки.md):
 * показывать ДЗ только тех уроков, которые ученику СЕЙЧАС открыты. Одно
 * правило — {@link keepLessonItem} — на «Домашние задания», блок «Задания»
 * курса, кнопки главной, бейдж меню и календарь.
 *
 * Открытость — `student_visible_topics()` в базе: тот же набор, по которому
 * политика `topic_homework_student_select` отдаёт ученику ДЗ (по датам —
 * `topic_open_now`, «по прохождению» — `student_progress_open_topics()`, с
 * учётом доступа подписки). Открылся урок — его ДЗ появляется само.
 *
 * Признак «урочного» курса (одно определение на все экраны):
 *   • в курсе есть хоть одна тема с `topics.lesson_format` — урок нового
 *     формата («ЕГЭ» / «тренировка»); у школьных групп (10А, 11А физика и
 *     математика, «Ученики 2026-2027») lesson_format пуст везде;
 *   • ИЛИ курс переведён в режим «по прохождению» (`course_unlock_modes`, §288).
 * ДЗ школьных групп и контрольные — как были, без этого правила.
 *
 * Только чтение. Сбой признака = «курс не урочный» (лучше лишняя ссылка, чем
 * пропавшее школьное ДЗ). Сбой набора открытых уроков = ДЗ урочного курса не
 * показываются (как было до 15.10): без него не отличить открытый урок от
 * закрытого.
 */
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/** Программа курса уже загружена — признак по её темам (без запроса). */
export function isLessonProgram(
  topics: ReadonlyArray<{ lesson_format?: string | null }>,
  mode: 'schedule' | 'progress' | null | undefined = null,
): boolean {
  return mode === 'progress' || topics.some((t) => !!t.lesson_format)
}

// Узкий тип цепочки: course_unlock_modes нет в сгенерированных типах (они
// отстают от прода, руками не дописываются — CLAUDE.md).
type Res = { data: unknown[] | null; count: number | null; error: unknown }
type Q = PromiseLike<Res> & {
  eq: (c: string, v: unknown) => Q
  not: (c: string, op: string, v: unknown) => Q
  in: (c: string, v: unknown[]) => Q
}
type Db = { from: (t: string) => { select: (c: string, o?: { count: 'exact'; head: true }) => Q } }

const TTL_MS = 5 * 60_000
const cache = new Map<string, { at: number; value: Promise<Set<string>> }>()

/** Для тестов: забыть ответы. */
export function resetLessonCourseCache() {
  cache.clear()
}

async function load(ids: string[]): Promise<Set<string>> {
  const db = supabase as unknown as Db
  const out = new Set<string>()
  try {
    const [counts, modes] = await Promise.all([
      Promise.all(ids.map(async (id) => {
        const { count, error } = await db.from('topics')
          .select('id, module:modules!inner(course_id)', { count: 'exact', head: true })
          .eq('module.course_id', id)
          .not('lesson_format', 'is', null)
        return { id, lesson: !error && (count ?? 0) > 0 }
      })),
      db.from('course_unlock_modes').select('course_id').in('course_id', ids).eq('mode', 'progress'),
    ])
    for (const c of counts) if (c.lesson) out.add(c.id)
    if (!modes.error) for (const r of (modes.data ?? []) as Array<{ course_id: string }>) out.add(r.course_id)
  } catch {
    /* сбой — ДЗ показываются как раньше */
  }
  return out
}

/** «Урочные» курсы среди данных. Ответ кэшируется на 5 минут. */
export function fetchLessonCourseIds(courseIds: Iterable<string>): Promise<Set<string>> {
  const ids = Array.from(new Set(courseIds)).filter(Boolean).sort()
  if (ids.length === 0) return Promise.resolve(new Set())
  const key = ids.join(',')
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const value = load(ids)
  cache.set(key, { at: Date.now(), value })
  return value
}

/** Хук: `ready` — ответ пришёл (до него строки не показываем, чтобы не мигали). */
export function useLessonCourseIds(courseIds: readonly string[]) {
  const key = Array.from(new Set(courseIds)).filter(Boolean).sort().join(',')
  const [got, setGot] = useState<{ key: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!key) return
    let alive = true
    fetchLessonCourseIds(key.split(',')).then((ids) => { if (alive) setGot({ key, ids }) })
    return () => {
      alive = false
    }
  }, [key])
  if (!key) return { ids: EMPTY, ready: true }
  return got && got.key === key ? { ids: got.ids, ready: true } : { ids: EMPTY, ready: false }
}

const EMPTY: ReadonlySet<string> = new Set()

// ── Открытые уроки ученика ────────────────────────────────────────────────

/** Короткий кэш: урок открывается сдачей предыдущего — ждать 5 минут нельзя. */
const OPEN_TTL_MS = 30_000
let openCache: { at: number; value: Promise<Set<string> | null> } | null = null

/** Для тестов: забыть ответы (и признак курсов, и открытые уроки). */
export function resetLessonHomeworkCache() {
  cache.clear()
  openCache = null
}

async function loadOpenTopics(): Promise<Set<string> | null> {
  try {
    const { data, error } = await (supabase as unknown as {
      rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>
    }).rpc('student_visible_topics')
    if (error || !Array.isArray(data)) return null
    return new Set(data.filter((x): x is string => typeof x === 'string'))
  } catch {
    return null
  }
}

/** Уроки, открытые ученику сейчас (`student_visible_topics()`); null — не узнали. */
export function fetchStudentOpenTopics(): Promise<Set<string> | null> {
  if (openCache && Date.now() - openCache.at < OPEN_TTL_MS) return openCache.value
  const value = loadOpenTopics()
  openCache = { at: Date.now(), value }
  return value
}

export interface LessonHomeworkFilter {
  /** Урочные курсы среди данных. */
  lessonIds: ReadonlySet<string>
  /** Открытые ученику уроки; null — набор не получен (или урочных курсов нет). */
  openTopics: ReadonlySet<string> | null
}

export const NO_LESSON_FILTER: LessonHomeworkFilter = { lessonIds: EMPTY, openTopics: null }

/**
 * Показывать ли ДЗ (тест, попытку, срок) ученику на общих экранах: курс не
 * урочный — да; урочный — только если урок открыт сейчас.
 */
export function keepLessonItem(
  f: LessonHomeworkFilter,
  courseId: string | null | undefined,
  topicId: string | null | undefined,
): boolean {
  if (!courseId || !f.lessonIds.has(courseId)) return true
  return !!topicId && !!f.openTopics?.has(topicId)
}

/** Признак курсов + открытые уроки (второй запрос — только если урочные курсы есть). */
export async function fetchLessonHomeworkFilter(courseIds: Iterable<string>): Promise<LessonHomeworkFilter> {
  const lessonIds = await fetchLessonCourseIds(courseIds)
  if (lessonIds.size === 0) return { lessonIds, openTopics: null }
  return { lessonIds, openTopics: await fetchStudentOpenTopics() }
}

/** Хук того же правила: `ready` — ответ пришёл (до него строки не показываем). */
export function useLessonHomeworkFilter(courseIds: readonly string[]) {
  const key = Array.from(new Set(courseIds)).filter(Boolean).sort().join(',')
  const [got, setGot] = useState<{ key: string; filter: LessonHomeworkFilter } | null>(null)
  useEffect(() => {
    if (!key) return
    let alive = true
    fetchLessonHomeworkFilter(key.split(',')).then((filter) => { if (alive) setGot({ key, filter }) })
    return () => {
      alive = false
    }
  }, [key])
  if (!key) return { filter: NO_LESSON_FILTER, ready: true }
  return got && got.key === key ? { filter: got.filter, ready: true } : { filter: NO_LESSON_FILTER, ready: false }
}
