import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardCheck, Plus, Settings2, Table2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/authStore'
import { CreateMockExamModal } from '@/components/modals/CreateMockExamModal'
import { mskDayLong, mskTime } from '@/lib/mockExamLesson'
import { cn } from '@/utils/cn'

/**
 * §224. Раздел «Пробники» в программе курса у преподавателя — тот же, что
 * ученик видит над разделами курса, плюс пробники без времени (их ученик не
 * видит — это сказано словами, иначе непонятно, «где оно на курсе»). Ссылки
 * «Настройка» и «Таблица», «Добавить пробник» — с подставленной группой.
 *
 * Не строка `modules`: список — пробники группы из `mock_exams`, в программе
 * курса ничего не заводится, синхронизация с шаблоном курса его не касается.
 */

export interface CourseMockRow {
  id: string
  title: string
  starts_at: string | null
  duration_minutes: number | null
  photo_grace_minutes: number | null
  template_id: string | null
}

type Kind = 'now' | 'upcoming' | 'unscheduled' | 'past'

export function mockRowKind(r: CourseMockRow, nowMs: number): Kind {
  if (!r.starts_at) return 'unscheduled'
  const s = new Date(r.starts_at).getTime()
  const e = s + (r.duration_minutes ?? 240) * 60000
  const p = e + (r.photo_grace_minutes ?? 15) * 60000
  if (nowMs < s) return 'upcoming'
  if (nowMs < p) return 'now'
  return 'past'
}

/** Идёт → ближайшие → без времени → прошедшие (свежие сверху). */
export function sortCourseMocks(rows: CourseMockRow[], nowMs: number): { row: CourseMockRow; kind: Kind }[] {
  const rank: Record<Kind, number> = { now: 0, upcoming: 1, unscheduled: 2, past: 3 }
  return rows
    .map(row => ({ row, kind: mockRowKind(row, nowMs) }))
    .sort((a, b) => rank[a.kind] - rank[b.kind]
      || (a.kind === 'past'
        ? (b.row.starts_at ?? '').localeCompare(a.row.starts_at ?? '')
        : (a.row.starts_at ?? '').localeCompare(b.row.starts_at ?? '') || a.row.title.localeCompare(b.row.title, 'ru')))
}

interface Chain extends PromiseLike<{ data: CourseMockRow[] | null; error: { message?: string } | null }> {
  eq(c: string, v: string): Chain
  order(c: string, o?: { ascending?: boolean; nullsFirst?: boolean }): Chain
}
const db = supabase as unknown as { from(t: string): { select(s: string): Chain } }

export function CourseMockExamsSection({ groupId, groupName }: { groupId: string; groupName: string | null }) {
  const profile = useAuthStore(s => s.profile)
  const canCreate = !!profile?.role && ['teacher', 'admin', 'owner'].includes(profile.role)
  const navigate = useNavigate()
  const [rows, setRows] = useState<CourseMockRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(null)
    db.from('mock_exams')
      .select('id, title, starts_at, duration_minutes, photo_grace_minutes, template_id')
      .eq('group_id', groupId)
      .order('starts_at', { ascending: true, nullsFirst: false })
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) { setError(err.message || 'Не удалось загрузить пробники'); setRows([]); return }
        setRows(data ?? [])
      })
    return () => { cancelled = true }
  }, [groupId])

  const now = Date.now()
  const items = rows ? sortCourseMocks(rows, now) : []

  return (
    <section className="rounded-2xl border border-gray-200 bg-white" data-testid="course-mock-exams" aria-labelledby="course-mock-exams-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-100 px-4 py-3">
        <h2 id="course-mock-exams-title" className="flex items-center gap-2 text-sm font-bold text-gray-900">
          <ClipboardCheck size={16} className="text-primary-600" aria-hidden />Пробники
          {groupName && <span className="font-normal text-gray-500">· группа {groupName}</span>}
        </h2>
        <span className="text-xs text-gray-500">ученики видят их отдельным разделом над программой</span>
        <div className="flex-1" />
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            data-testid="course-mock-add"
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-graphite-800 hover:border-primary-200 sm:min-h-0"
          >
            <Plus size={14} />Добавить пробник
          </button>
        )}
      </div>
      {rows == null ? (
        <p className="px-4 py-3 text-sm text-gray-400">Загрузка…</p>
      ) : error ? (
        <p className="px-4 py-3 text-sm text-red-700">{error}</p>
      ) : items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500" data-testid="course-mock-empty">У группы пока нет пробников — ученики раздела «Пробники» не видят.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map(({ row, kind }) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5" data-testid="course-mock-row" data-kind={kind}>
              <span className="min-w-0 flex-1 text-sm font-medium text-gray-900">{row.title}</span>
              <span className={cn('whitespace-nowrap rounded px-1.5 py-px text-xs', KIND_CLS[kind])} data-testid="course-mock-when">{whenText(row, kind)}</span>
              <span className="inline-flex gap-1.5">
                <Link to={`/mock-exams/${row.id}/setup`} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-graphite-800 hover:border-primary-200 sm:min-h-0">
                  <Settings2 size={13} />Настройка
                </Link>
                {row.template_id && (
                  <Link to={`/mock-exams/${row.id}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-graphite-800 hover:border-primary-200 sm:min-h-0">
                    <Table2 size={13} />Таблица
                  </Link>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <CreateMockExamModal
          open={creating}
          onClose={() => setCreating(false)}
          defaultGroup={{ id: groupId, name: groupName ?? 'группа курса' }}
          onCreated={examId => {
            setCreating(false)
            // Из программы курса пробник заводят, чтобы назначить время, — сразу в настройку.
            navigate(`/mock-exams/${examId}/setup`)
          }}
        />
      )}
    </section>
  )
}

const KIND_CLS: Record<Kind, string> = {
  now: 'bg-primary-600 text-white',
  upcoming: 'bg-slate-100 text-graphite-700',
  unscheduled: 'bg-amber-50 text-amber-900',
  past: 'bg-slate-50 text-graphite-500',
}

function whenText(r: CourseMockRow, kind: Kind): string {
  if (kind === 'unscheduled' || !r.starts_at) return 'время не назначено — ученики не видят'
  const s = new Date(r.starts_at).getTime()
  const e = new Date(s + (r.duration_minutes ?? 240) * 60000).toISOString()
  if (kind === 'now') return `идёт · до ${mskTime(e)}`
  if (kind === 'upcoming') return `${mskDayLong(r.starts_at)}, ${mskTime(r.starts_at)}–${mskTime(e)}`
  return `прошёл ${mskDayLong(r.starts_at)}`
}
