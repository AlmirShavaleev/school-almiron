/**
 * Ограниченно-параллельная загрузка каталога.
 * Не запускаем сотни запросов одновременно и не зависим от порядка их завершения.
 */
export async function mapCatalogBatches<T, R>(
  items: readonly T[],
  batchSize: number,
  concurrency: number,
  loadBatch: (batch: T[]) => Promise<readonly R[]>,
): Promise<R[]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError('batchSize must be positive')
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('concurrency must be positive')

  const batches: T[][] = []
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize))
  }

  const rows: R[] = []
  for (let index = 0; index < batches.length; index += concurrency) {
    const pages = await Promise.all(batches.slice(index, index + concurrency).map(loadBatch))
    for (const page of pages) rows.push(...page)
  }
  return rows
}
