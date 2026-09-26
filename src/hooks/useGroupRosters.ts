import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { byName, type RosterStudent } from '@/lib/mockExamVariants'

// Типы базы не перегенерированы после §221 — строки через `any` (как в lib/myMockExams).
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * §229. Ученики выбранных групп (по алфавиту) — для таблицы «Кому какой
 * вариант». Читается под RLS персонала (`group_students` пускает персонал
 * курса); чего не видно — того и нет в таблице, выдачу таким ученикам сделает
 * база при первом заходе (наименее занятый вариант).
 */
type Res = { data: any[] | null; error: { message?: string } | null }
interface Chain extends PromiseLike<Res> { in(c: string, v: string[]): Chain }
const db = supabase as unknown as { from(t: string): { select(s: string): Chain } }

export function useGroupRosters(groupIds: string[]): { rosters: Record<string, RosterStudent[]>; loading: boolean } {
  const key = groupIds.slice().sort().join(',')
  const [state, setState] = useState<{ key: string; rosters: Record<string, RosterStudent[]> }>({ key: '', rosters: {} })

  useEffect(() => {
    if (!key) return
    let cancelled = false
    db.from('group_students').select('group_id, student_id, students(id, profiles(full_name))').in('group_id', key.split(',')).then(({ data }) => {
      if (cancelled) return
      const out: Record<string, RosterStudent[]> = Object.fromEntries(key.split(',').map(g => [g, []]))
      for (const r of data ?? []) {
        const list = out[r.group_id]
        if (!list) continue
        list.push({ id: r.student_id, name: r.students?.profiles?.full_name || '—' })
      }
      for (const g of Object.keys(out)) out[g] = byName(out[g])
      setState({ key, rosters: out })
    }, () => { if (!cancelled) setState({ key, rosters: {} }) })
    return () => { cancelled = true }
  }, [key])

  return { rosters: key ? state.rosters : {}, loading: !!key && state.key !== key }
}
