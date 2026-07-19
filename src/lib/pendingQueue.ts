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

export function getQueueItemReviewPath(item: QueueItem): string {
  return item.source === 'task_collection'
    ? `/review-submissions/${item.submissionId}`
    : `/homeworks/${item.homework.id}/review/${item.group.id}/${item.student.id}`
}
