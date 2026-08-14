import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Статистика посещений сайта из Vercel Web Analytics (вкладка «Сайт»).
 *
 * Токен Vercel сюда не попадает: всё считает edge-функция `vercel-analytics`,
 * она же проверяет права и держит кэш. Хук только нормализует ответ — в
 * компоненте не должно быть разбора чужих форматов.
 *
 * Это статистика САЙТА, а не учебного процесса. Школьные срезы (§107) живут
 * на вкладке «Обзор», считаются по своим данным и с этими числами не
 * сравниваются.
 */

export interface SiteTotals {
  visitors:  number
  pageviews: number
}

export interface SiteDay {
  day:       string
  visitors:  number
  pageviews: number
}

export interface SiteSection {
  section:   string
  pageviews: number
}

export interface SiteBreakdown {
  label:     string
  visitors:  number
  pageviews: number
}

export interface SiteAnalyticsData {
  totals7:    SiteTotals
  totals30:   SiteTotals
  days:       SiteDay[]
  sections:   SiteSection[]
  referrers:  SiteBreakdown[]
  devices:    SiteBreakdown[]
  countries:  SiteBreakdown[]
  /** Когда данные забраны из Vercel. Показывается подписью на экране. */
  fetchedAt:  string | null
  /** Ответ отдан из кэша, а не свежим запросом. */
  fromCache:  boolean
  /** Кнопку «Обновить» нажали чаще раза в минуту — отдан прежний ответ. */
  throttled:  boolean
  /** Часть запросов к Vercel не прошла: числа неполные. */
  partial:    boolean
  /** Сколько дней реально вернул Vercel — окно истории тарифа. */
  daysReturned: number
}

const EMPTY: SiteAnalyticsData = {
  totals7:  { visitors: 0, pageviews: 0 },
  totals30: { visitors: 0, pageviews: 0 },
  days: [], sections: [], referrers: [], devices: [], countries: [],
  fetchedAt: null, fromCache: false, throttled: false, partial: false,
  daysReturned: 0,
}

/** Пустой ярлык у Vercel значит «прямой заход» или «не определено». */
function labelOr(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim()
  return text === '' ? fallback : text
}

function totals(node: unknown): SiteTotals {
  const data = (node as { data?: { visitors?: number; pageviews?: number } } | null)?.data
  return { visitors: Number(data?.visitors ?? 0), pageviews: Number(data?.pageviews ?? 0) }
}

function rows(node: unknown): Array<Record<string, unknown>> {
  const data = (node as { data?: unknown } | null)?.data
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []
}

function breakdown(node: unknown, key: string, fallback: string): SiteBreakdown[] {
  return rows(node).map(row => ({
    label:     labelOr(row[key], fallback),
    visitors:  Number(row.visitors ?? 0),
    pageviews: Number(row.pageviews ?? 0),
  }))
}

export function useVercelAnalytics() {
  const [data, setData] = useState<SiteAnalyticsData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [force, setForce] = useState(false)

  const reload = useCallback(() => { setForce(true); setTick(t => t + 1) }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const { data: raw, error: fnErr } = await supabase.functions.invoke('vercel-analytics', {
        body: force ? { force: true } : {},
      })
      if (cancelled) return

      if (fnErr) {
        // Функция уже перевела отказ на человеческий («не включён», «токен не
        // подошёл»), но при сетевой ошибке сюда придёт голое сообщение.
        setError(fnErr.message || 'Не удалось получить статистику сайта')
        setData(EMPTY)
        setLoading(false)
        return
      }

      const body = raw as Record<string, unknown> | null
      // Отказ приезжает телом с полем error — это НЕ ноль посещений.
      if (body && typeof body.error === 'string') {
        setError(String(body.message ?? 'Статистика недоступна'))
        setData(EMPTY)
        setLoading(false)
        return
      }

      setData({
        totals7:  totals(body?.count7),
        totals30: totals(body?.count30),
        days: rows(body?.byDay).map(row => ({
          day:       String(row.timestamp ?? ''),
          visitors:  Number(row.visitors ?? 0),
          pageviews: Number(row.pageviews ?? 0),
        })),
        sections: Array.isArray(body?.sections)
          ? (body!.sections as SiteSection[]).map(s => ({
              section: String(s.section ?? '/'),
              pageviews: Number(s.pageviews ?? 0),
            }))
          : [],
        referrers: breakdown(body?.byReferrer, 'referrerHostname', 'прямой заход'),
        devices:   breakdown(body?.byDevice, 'deviceType', 'неизвестно'),
        countries: breakdown(body?.byCountry, 'country', 'неизвестно'),
        fetchedAt: typeof body?.fetched_at === 'string' ? body.fetched_at : null,
        fromCache: body?.source === 'cache',
        throttled: body?.throttled === true,
        partial:   body?.partial === true,
        daysReturned: Number(
          (body?.meta as { days_returned?: number } | undefined)?.days_returned ?? 0,
        ),
      })
      setLoading(false)
    }

    load()
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Не удалось получить статистику сайта')
        setLoading(false)
      })
      .finally(() => { if (!cancelled) setForce(false) })

    return () => { cancelled = true }
    // force намеренно вне зависимостей: он взводится вместе с tick и гасится
    // после запроса, иначе его сброс запускал бы второй заход.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  return { ...data, loading, error, reload }
}
