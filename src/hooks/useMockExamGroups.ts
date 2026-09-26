import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Типы базы не перегенерированы после §221 — строки новых таблиц через `any` (как в lib/myMockExams).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMyTeachingScope } from '@/hooks/useMyTeachingScope'

/**
 * §228. Группы для чипов формы «Новый пробник» — с числом учеников.
 *
 * Список — то, что отдаёт RLS на `groups` (`groups_select_all` →
 * `course_is_staff`): преподавателю — группы курсов, где он персонал, включая
 * курс, которым он владеет (раньше модалка §218 брала только группы, где он
 * записан учителем, и владелец курса без своей группы не видел её вовсе).
 * Владельцу в режиме учителя RLS отдаёт всю школу — сужаем тем же набором,
 * что у списка пробников (`useMyTeachingScope`, §219).
 */
export interface MockExamGroupOption { id: string; name: string; count: number | null }

type Res = { data: any[] | null; error: { message?: string } | null }
interface Chain extends PromiseLike<Res> { order(c: string): Chain }
const db = supabase as unknown as { from(t: string): { select(s: string): Chain } }

export function useMockExamGroups(extra?: { id: string; name: string } | null) {
  const scope = useMyTeachingScope()
  const scopeKey = scope.active ? (scope.loading ? 'loading' : scope.courseIds.join(',')) : 'off'
  const [groups, setGroups] = useState<MockExamGroupOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (scopeKey === 'loading') return
    let cancelled = false
    db.from('groups').select('id, name, course_id, is_active, group_students(count)').order('name').then(({ data }) => {
      if (cancelled) return
      const allowed = scope.active ? new Set(scope.courseIds) : null
      const list = (data ?? [])
        .filter(g => g.is_active !== false && (!allowed || allowed.has(g.course_id)))
        .map(g => ({ id: g.id as string, name: (g.name as string) || 'группа', count: countOf(g.group_students) }))
      setGroups(list)
      setLoading(false)
    })
    return () => { cancelled = true }
    // scope.courseIds входит через scopeKey — строкой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

  const withExtra = extra && !groups.some(g => g.id === extra.id)
    ? [{ id: extra.id, name: extra.name, count: null }, ...groups]
    : groups
  return { groups: withExtra, loading }
}

/** PostgREST отдаёт `group_students(count)` как `[{ count: 16 }]`. */
function countOf(v: unknown): number | null {
  if (!Array.isArray(v)) return null
  const c = (v[0] as { count?: unknown } | undefined)?.count
  return typeof c === 'number' ? c : v.length
}
