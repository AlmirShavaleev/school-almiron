import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { parseFeed, parsePulse, type FeedEvent, type PulseData } from '@/lib/livePulse'

/**
 * Числа, графики и лента живой панели «Сейчас».
 *
 * Два запроса на открытие вкладки: `admin_live_pulse()` и `admin_live_feed()`.
 * Больше ничего отсюда не уходит — «работ ждут проверки», «сдано сегодня» и
 * список пропавших панель берёт из уже загруженных на странице §107, а не
 * считает заново.
 *
 * Лента обновляется ПОДПИСКОЙ, а не опросом. Но подписка служит сигналом «что-
 * то произошло», а список перезапрашивается функцией: сырая строка из
 * `postgres_changes` не знает ни имени человека, ни названия темы, а «сдал
 * работу» у нас вообще UPDATE черновика, а не INSERT.
 */

const FEED_LIMIT = 20
/** Всплеск правок (пачка отметок по рубрикам) схлопывается в один перезапрос. */
const REFETCH_DEBOUNCE_MS = 1500
/** Таблицы ленты — те же четыре, что опубликованы миграцией 20260909213307. */
const FEED_TABLES = [
  'topic_homework_attempts',
  'topic_homework_reviews',
  'topic_section_marks',
  'group_students',
] as const

export interface LivePulseState {
  pulse:   PulseData | null
  feed:    FeedEvent[]
  loading: boolean
  error:   string | null
  fetchedAt: string | null
  /** Подписка на изменения поднялась. Ложь — лента живёт, но сама не обновится. */
  liveFeed: boolean
  reload:  () => void
}

function refusal(message: string): string {
  return message.includes('ONLY_ADMIN_SEES_SCHOOL_STATS')
    ? 'Живую панель школы видит только администратор'
    : message || 'Не удалось загрузить живую панель'
}

export function useLivePulse(): LivePulseState {
  const [pulse, setPulse] = useState<PulseData | null>(null)
  const [feed, setFeed] = useState<FeedEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [liveFeed, setLiveFeed] = useState(false)
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick(t => t + 1), [])

  // ── Первичная загрузка ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      const db = supabase as any
      const [pulseRes, feedRes] = await Promise.all([
        db.rpc('admin_live_pulse'),
        db.rpc('admin_live_feed', { p_limit: FEED_LIMIT }),
      ])
      if (cancelled) return

      const failure = [pulseRes, feedRes].find(r => r?.error)
      if (failure) {
        // Отказ словами, а не пустая панель: молчащий экран неотличим от школы,
        // в которой ничего не происходит (уроки §47/§54).
        setError(refusal(String(failure.error?.message ?? '')))
        setPulse(null)
        setFeed([])
        setLoading(false)
        return
      }

      setPulse(parsePulse(pulseRes.data))
      setFeed(parseFeed(feedRes.data))
      setFetchedAt(new Date().toISOString())
      setLoading(false)
    }

    load().catch(err => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : 'Не удалось загрузить живую панель')
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [tick])

  // ── Лента: подписка как сигнал к перезапросу ─────────────────────────────
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let channel: RealtimeChannel | null = null

    async function refetchFeed() {
      const { data, error: feedError } = await (supabase as any)
        .rpc('admin_live_feed', { p_limit: FEED_LIMIT })
      if (cancelled || feedError) return
      setFeed(parseFeed(data))
      setFetchedAt(new Date().toISOString())
    }

    function scheduleRefetch() {
      // Вкладка в фоне не жжёт ни запросы, ни батарею: помечаем, что событие
      // было, и догоняем одним запросом, когда на вкладку вернутся.
      if (typeof document !== 'undefined' && document.hidden) {
        pendingRef.current = true
        return
      }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => { void refetchFeed() }, REFETCH_DEBOUNCE_MS)
    }

    function onVisible() {
      if (typeof document === 'undefined' || document.hidden) return
      if (!pendingRef.current) return
      pendingRef.current = false
      void refetchFeed()
    }

    // ОДИН канал на все четыре таблицы, а не четыре канала: подписки — это
    // сокеты, и утечка на живом экране означает растущий счёт.
    channel = supabase.channel('school-live-feed')
    for (const table of FEED_TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefetch)
    }
    channel.subscribe(status => {
      if (cancelled) return
      // Отказ подписки НЕ ломает панель: лента уже загружена запросом, просто
      // перестаёт обновляться сама. Так и пишем на экране.
      setLiveFeed(status === 'SUBSCRIBED')
    })

    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      pendingRef.current = false
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  return { pulse, feed, loading, error, fetchedAt, liveFeed, reload }
}
