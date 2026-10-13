/**
 * §291. Экран «Скорость» — вызовы базы (только админ; права — в SQL) и
 * чистые помощники периода и подписей.
 */
import { supabase } from '@/lib/supabase'

export type PerfPeriod = 'hour' | 'today' | 'week'

export interface PerfRow { label: string; n: number; p50: number; p95: number; max: number; errors: number; students: number }
export interface PerfHour { hour: string; n: number; p50: number; p95: number; students: number }
export interface PerfPerson { profile_id: string; full_name: string | null; email: string | null; role: string | null; n: number; route_p95: number | null }
export interface PerfRecent { at: string; kind: 'route' | 'api' | 'nav'; label: string; ms: number; status: number | null; device: string }

/** Границы периода: час — последние 60 минут; сегодня — с полуночи МСК; неделя — 7 суток. */
export function periodRange(p: PerfPeriod, now: Date = new Date()): { from: string; to: string } {
  const to = new Date(now.getTime() + 60_000)
  let from: Date
  if (p === 'hour') from = new Date(now.getTime() - 3_600_000)
  else if (p === 'week') from = new Date(now.getTime() - 7 * 86_400_000)
  else {
    const msk = new Date(now.getTime() + 3 * 3_600_000)
    from = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()) - 3 * 3_600_000)
  }
  return { from: from.toISOString(), to: to.toISOString() }
}

/** «1,2 с» / «340 мс». */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)} мс`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0).replace('.', ',')} с`
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never)
  if (error) throw new Error(error.message)
  return (data ?? []) as T
}

export function fetchPerfSummary(kind: 'route' | 'api' | 'nav', p: PerfPeriod, profileId: string | null = null) {
  const r = periodRange(p)
  return call<PerfRow[]>('admin_perf_summary', { p_kind: kind, p_from: r.from, p_to: r.to, p_profile_id: profileId })
}

export function fetchPerfHourly(kind: 'route' | 'api' | 'nav', label: string, p: PerfPeriod) {
  // график по часам — минимум сутки, иначе один столбец
  const r = periodRange(p === 'hour' ? 'today' : p)
  return call<PerfHour[]>('admin_perf_hourly', { p_kind: kind, p_label: label, p_from: r.from, p_to: r.to })
}

export function fetchPerfPeople(p: PerfPeriod) {
  const r = periodRange(p)
  return call<PerfPerson[]>('admin_perf_people', { p_from: r.from, p_to: r.to })
}

export function fetchPerfRecent(profileId: string, limit = 100) {
  return call<PerfRecent[]>('admin_perf_recent', { p_profile_id: profileId, p_limit: limit })
}
