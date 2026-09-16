import { fetchReviewQueuePage, type ReviewQueueItem, type ReviewQueueMode } from '@/lib/reviewQueue'

export type QueueItem = ReviewQueueItem

export async function loadPendingQueueItems(
  _supabase: unknown,
  profile: { id: string; role: string } | null | undefined,
  mode: Extract<ReviewQueueMode, 'pending' | 'returned'> = 'pending',
): Promise<QueueItem[]> {
  if (!profile) return []
  const page = await fetchReviewQueuePage(mode, { limit: 100 })
  return page.items
}

export function resolveNextQueueItem(
  items: QueueItem[],
  current: { submissionId: string; source: QueueItem['source'] } | null,
): QueueItem | null {
  if (!items.length) return null
  if (!current) return items[0] ?? null
  const index = items.findIndex(item => item.submissionId === current.submissionId && item.source === current.source)
  if (index === -1) return items[0] ?? null
  return items[index + 1] ?? null
}

/**
 * Единственный разбор работы, оставшийся в этой очереди, — подборка задач
 * (`/review-submissions/:id`). Ветка `legacy_homework` вела на
 * `/homeworks/:id/review/:groupId/:studentId`; в §185 эти экраны удалены
 * вместе со старым контуром ДЗ, а очередь с тех пор просит у RPC только
 * `task_collection` (см. `HomeworkQueuePage`).
 */
export function getQueueItemReviewPath(item: QueueItem): string {
  return `/review-submissions/${item.submissionId}`
}
