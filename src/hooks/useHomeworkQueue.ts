import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuthStore } from '@/store/authStore'
import {
  fetchReviewQueueCounts,
  fetchReviewQueuePage,
  type QueueBucket,
  type ReviewQueueCounts,
  type ReviewQueueItem,
  type ReviewQueueMode,
  type ReviewQueueSource,
  type ReviewQueueStatus,
  type ReviewQueueCursor,
} from '@/lib/reviewQueue'

export type QueueMode = Exclude<ReviewQueueMode, 'all'>
export type QueueReviewStatus = ReviewQueueStatus
export type QueueItem = ReviewQueueItem
export type { QueueBucket }

export interface QueueCounts {
  urgent: number
  new: number
  backlog: number
  total: number
}

export interface QueueTabCounts extends ReviewQueueCounts {}

export interface HomeworkQueueFilters {
  courseId?: string | null
  groupId?: string | null
  studentId?: string | null
  sourceType?: ReviewQueueSource | null
  overdueOnly?: boolean
}

const DEFAULT_PAGE_SIZE = 50

export function useHomeworkQueue(mode: QueueMode = 'pending', filters: HomeworkQueueFilters = {}, pageSize = DEFAULT_PAGE_SIZE) {
  const profile = useAuthStore(s => s.profile)
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<ReviewQueueCursor | null>(null)
  const [tabCounts, setTabCounts] = useState<QueueTabCounts>({ pending: 0, returned: 0, checked: 0 })
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(t => t + 1), [])
  const inFlightRef = useRef(false)
  const lastLoadEndRef = useRef(0)
  const RELOAD_THROTTLE_MS = 30_000

  const normalizedFilters = {
    courseId: filters.courseId ?? null,
    groupId: filters.groupId ?? null,
    studentId: filters.studentId ?? null,
    sourceType: filters.sourceType ?? null,
    overdueOnly: filters.overdueOnly ?? false,
  }

  const filterItems = useCallback((rows: QueueItem[]) => {
    return normalizedFilters.overdueOnly ? rows.filter(item => item.overdue) : rows
  }, [normalizedFilters.overdueOnly])

  const loadPage = useCallback(async (cursor: ReviewQueueCursor | null, append: boolean) => {
    const page = await fetchReviewQueuePage(mode, {
      courseId: normalizedFilters.courseId,
      groupId: normalizedFilters.groupId,
      studentId: normalizedFilters.studentId,
      sourceType: normalizedFilters.sourceType,
      cursor,
      limit: pageSize,
    })
    const nextItems = filterItems(page.items)
    setItems(prev => append ? [...prev, ...nextItems] : nextItems)
    setHasMore(page.hasMore)
    setNextCursor(page.nextCursor)
  }, [filterItems, mode, normalizedFilters.courseId, normalizedFilters.groupId, normalizedFilters.sourceType, normalizedFilters.studentId, pageSize])

  const loadCounts = useCallback(async () => {
    const counts = await fetchReviewQueueCounts({
      courseId: normalizedFilters.courseId,
      groupId: normalizedFilters.groupId,
      studentId: normalizedFilters.studentId,
      sourceType: normalizedFilters.sourceType,
    })
    setTabCounts(counts)
  }, [normalizedFilters.courseId, normalizedFilters.groupId, normalizedFilters.sourceType, normalizedFilters.studentId])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    inFlightRef.current = true
    setLoading(true)
    setItems([])
    setHasMore(false)
    setNextCursor(null)

    Promise.all([
      loadPage(null, false),
      loadCounts(),
    ]).finally(() => {
      inFlightRef.current = false
      lastLoadEndRef.current = Date.now()
      if (!cancelled) setLoading(false)
    })

    function onFocus() {
      if (mode === 'checked') return
      if (inFlightRef.current) return
      if (Date.now() - lastLoadEndRef.current < RELOAD_THROTTLE_MS) return
      setTick(t => t + 1)
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [
    profile?.id,
    profile?.role,
    tick,
    mode,
    loadCounts,
    loadPage,
  ])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      await loadPage(nextCursor, true)
    } finally {
      setLoadingMore(false)
    }
  }, [loadPage, loadingMore, nextCursor])

  const counts: QueueCounts = {
    urgent: items.filter(i => i.bucket === 'urgent').length,
    new: items.filter(i => i.bucket === 'new').length,
    backlog: items.filter(i => i.bucket === 'backlog').length,
    total: items.length,
  }

  return { items, counts, loading, loadingMore, reload, hasMore, loadMore, tabCounts }
}
