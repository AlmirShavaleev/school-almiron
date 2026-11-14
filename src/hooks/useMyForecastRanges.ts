import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchMyScoreForecast, type StoredForecast } from '@/lib/scoreForecast'
import { buildForecastView, normalizeForecastResponse } from '@/lib/egeForecast'
import { activeSpec } from '@/lib/egeScales'

/** Прогноз по предмету для виджета: диапазон или null («0» — данных мало). */
export interface ForecastRange { subject: string; low: number | null; high: number | null }

/** «58–70»; одинаковые концы — одно число; данных мало — «0» (письмо ЛК_виджет_прогноз_балла.md, 17.10). */
export function rangeText(r: ForecastRange | null | undefined): string {
  if (!r || r.low == null || r.high == null) return '0'
  return r.low === r.high ? String(r.low) : `${r.low}–${r.high}`
}

/**
 * Виджет «Прогноз ЕГЭ» (письмо 17.10): хранимый прогноз (`my_score_forecast`,
 * forecast-daily). Пока миграции нет — прежний расчёт в браузере по
 * `student_exam_forecast_evidence()` той же моделью; сбой — пусто (виджет
 * покажет «0»). null — ещё грузится.
 */
/**
 * The dashboard already reads my_score_forecast for the goal caption.
 * When provided, reuse that result instead of sending the same RPC twice.
 * undefined = fetch independently (for other consumers); null = no stored
 * forecast, so use the legacy evidence fallback without retrying the RPC.
 */
export function useMyForecastRanges(enabled: boolean, storedForecast?: StoredForecast[] | null): ForecastRange[] | null {
  const [rows, setRows] = useState<ForecastRange[] | null>(null)
  useEffect(() => {
    if (!enabled) { setRows(null); return }
    let alive = true
    void (async () => {
      const stored = storedForecast === undefined ? await fetchMyScoreForecast() : storedForecast
      if (stored) {
        if (alive) setRows(stored.map(r => ({ subject: r.subject, low: r.ready ? r.low : null, high: r.ready ? r.high : null })))
        return
      }
      try {
        const { data, error } = await supabase.rpc('student_exam_forecast_evidence' as never)
        const resp = error ? null : normalizeForecastResponse(data)
        const out: ForecastRange[] = (resp?.subjects ?? []).map(s => {
          const spec = activeSpec(s.subject)
          if (!spec || !resp) return { subject: s.subject, low: null, high: null }
          const v = buildForecastView(spec, resp.evidence, resp.now)
          return v.current.ready ? { subject: s.subject, low: v.low, high: v.high } : { subject: s.subject, low: null, high: null }
        })
        if (alive) setRows(out)
      } catch {
        if (alive) setRows([])
      }
    })()
    return () => { alive = false }
  }, [enabled, storedForecast])
  return rows
}
