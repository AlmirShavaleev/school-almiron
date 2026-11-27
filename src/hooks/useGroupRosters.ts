import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { byName, type RosterStudent } from '@/lib/mockExamVariants'

// Типы базы не перегенерированы после §221 — строки через `any` (как в lib/myMockExams).
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Ученики доступных групп по алфавиту для выбора участников и раздачи вариантов. */
type Res = { data: any[] | null; error: { message?: string } | null }
interface Chain extends PromiseLike<Res> { in(c: string, v: string[]): Chain }
const db = supabase as unknown as { from(t: string): { select(s: string): Chain } }

export function useGroupRosters(groupIds: string[]) {
  const key = groupIds.slice().sort().join(',')
  const [attempt, setAttempt] = useState(0)
  const request = key ? `${attempt}:${key}` : ''
  const [state, setState] = useState<{ request: string; rosters: Record<string, RosterStudent[]>; error: string | null }>(
    { request: '', rosters: {}, error: null },
  )

  useEffect(() => {
    if (!key) return
    let cancelled = false
    function fail(message?: string) {
      if (!cancelled) setState(prev => ({ ...prev, request, error: message || 'Не удалось загрузить учеников' }))
    }
    db.from('group_students').select('group_id, student_id, students(id, profiles(full_name))').in('group_id', key.split(',')).then(({ data, error }) => {
      if (cancelled) return
      if (error) { fail(error.message); return }
      const out: Record<string, RosterStudent[]> = Object.fromEntries(key.split(',').map(g => [g, []]))
      for (const r of data ?? []) {
        const list = out[r.group_id]
        if (!list) continue
        list.push({ id: r.student_id, name: r.students?.profiles?.full_name || '—' })
      }
      for (const g of Object.keys(out)) out[g] = byName(out[g])
      setState(prev => ({ request, rosters: { ...prev.rosters, ...out }, error: null }))
    }, () => fail())
    return () => { cancelled = true }
  }, [key, request])

  return {
    rosters: state.rosters,
    loading: !!request && state.request !== request,
    error: request && state.request === request ? state.error : null,
    retry: () => setAttempt(n => n + 1),
  }
}
