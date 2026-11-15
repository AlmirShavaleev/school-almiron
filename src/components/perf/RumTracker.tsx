/**
 * §291. Включает RUM (один раз) и сообщает ему о смене маршрута. Ничего не
 * рисует. Стоит внутри BrowserRouter.
 *
 * 15.11 (утро 14.11, ~10 учеников, пул PostgREST исчерпан): RUM писал в базу
 * у КАЖДОГО ученика раз в 30 с и при каждом уходе вкладки в фон — `perf_ingest`
 * оказался самым дорогим вызовом школы по суммарному времени. Теперь меряем
 * долю сессий (по умолчанию 20 %) и шлём раз в 2 минуты; для статистики
 * скорости этого достаточно. Долю можно поменять без кода:
 * `VITE_RUM_SAMPLE_RATE` в Vercel (0…1).
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { routeChanged, startRum } from '@/lib/perf/rum'
import { rumTransport } from '@/lib/perf/rumTransport'

export const RUM_DEFAULT_SAMPLE_RATE = 0.2
export const RUM_FLUSH_INTERVAL_MS = 120_000

/** Доля сессий с RUM: из env, иначе по умолчанию; мусор и выход за 0…1 — по умолчанию. */
export function rumSampleRate(raw: unknown = import.meta.env.VITE_RUM_SAMPLE_RATE): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : RUM_DEFAULT_SAMPLE_RATE
}

export function RumTracker() {
  const { pathname } = useLocation()
  useEffect(() => startRum(rumTransport, { sampleRate: rumSampleRate(), intervalMs: RUM_FLUSH_INTERVAL_MS }), [])
  useEffect(() => { routeChanged(pathname) }, [pathname])
  return null
}
