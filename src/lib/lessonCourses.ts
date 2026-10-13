/**
 * «Урочный» курс ученика — курс из раздела «Мой курс», где ДЗ живут внутри
 * уроков (решение владельца 13.10: «с аккаунта ученика убрать ссылки на ДЗ в
 * моём курсе»). ДЗ таких курсов не показываются ни на «Домашних заданиях», ни
 * в блоке «Задания» курса, ни в кнопках главной и бейдже меню, ни в
 * календаре — только в самом уроке.
 *
 * Признак (одно определение на все экраны):
 *   • в курсе есть хоть одна тема с `topics.lesson_format` — урок нового
 *     формата («ЕГЭ» / «тренировка»): на 13.10 это «Физика ЕГЭ (новый)» и его
 *     копии («… Тестовый», «… подписка (тест)»); у школьных групп (10А, 11А
 *     физика и математика, «Ученики 2026-2027») lesson_format пуст везде;
 *   • ИЛИ курс переведён в режим «по прохождению» (`course_unlock_modes`, §288).
 *
 * Только чтение: обе таблицы ученику открыты (программу курса и режим он и так
 * читает). Сбой запроса = «курс не урочный»: ДЗ показываются, как раньше —
 * лучше лишняя ссылка, чем пропавшее школьное ДЗ.
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
