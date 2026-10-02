/** §254. Карточка активности, пока база не ответила или ответила ошибкой. */
export function LoadFail({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return <div className="h-24 animate-pulse rounded-xl bg-graphite-100" aria-label="Загружаем" />
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-graphite-500">
      <span>Не удалось загрузить активность.</span>
      <button type="button" onClick={onRetry} className="font-semibold text-primary-700 hover:underline">Повторить</button>
    </div>
  )
}
