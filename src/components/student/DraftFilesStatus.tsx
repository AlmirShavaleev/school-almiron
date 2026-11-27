export function DraftFilesStatus({ phase, retry }: {
  phase: 'restoring' | 'error' | 'ready'
  retry: () => void
}) {
  if (phase === 'ready') return null
  if (phase === 'restoring') {
    return <p role="status" className="text-sm text-gray-600">Восстанавливаем вложения из черновика…</p>
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-red-700">
      <p role="alert">Не удалось восстановить вложения. Повторите попытку, чтобы отправить работу.</p>
      <button type="button" className="underline" onClick={retry}>Повторить восстановление</button>
    </div>
  )
}
