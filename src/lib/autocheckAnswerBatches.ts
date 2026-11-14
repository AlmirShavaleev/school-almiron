/**
 * Keep PostgREST .in(task_id, ...) requests below practical URL limits.
 * Always read all batches: omitting any answers can falsely mark finished
 * autocheck work as unfinished. Errors preserve the journal status instead.
 */
export const AUTOCHECK_ANSWER_BATCH_SIZE = 40

export interface AutocheckAnswer {
  task_id: string
  is_correct: boolean
}
export type AnswerBatchResult = {
  data: AutocheckAnswer[] | null
  error: unknown
}

/**
 * Returns null on any failed batch. RLS continues to scope every query to
 * the authenticated student's rows. Sequential batches avoid a request burst.
 */
export async function loadAutocheckAnswersBatched(
  taskIds: readonly string[],
  fetchBatch: (ids: string[]) => PromiseLike<AnswerBatchResult>,
): Promise<AutocheckAnswer[] | null> {
  const ids = [...new Set(taskIds)]
  const answers: AutocheckAnswer[] = []
  for (let i = 0; i < ids.length; i += AUTOCHECK_ANSWER_BATCH_SIZE) {
    const batch = ids.slice(i, i + AUTOCHECK_ANSWER_BATCH_SIZE)
    try {
      const result = await fetchBatch(batch)
      if (result.error || !Array.isArray(result.data)) return null
      answers.push(...result.data)
    } catch {
      return null
    }
  }
  return answers
}
