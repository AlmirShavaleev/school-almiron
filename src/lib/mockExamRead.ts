const PAGE_SIZE = 1000

type RowsResult<T> = { data: T[] | null; error: { message?: string } | null }

/** Read an ordered result set across PostgREST's row limit. */
export async function readMockExamRows<T>(
  page: (from: number, to: number) => PromiseLike<RowsResult<T>>,
): Promise<RowsResult<T>> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) return { data: null, error }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return { data: rows, error: null }
  }
}
