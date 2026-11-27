import { useEffect, useState } from 'react'
import { checkRelease, requestPageReload, type ReleaseStatus } from '@/lib/releaseRecovery'
import { noteReload } from '@/lib/perf/rum'

const messages: Record<ReleaseStatus, string> = {
  updated: 'Доступна другая версия сайта. Обновите страницу, чтобы продолжить.',
  current: 'Версия сайта актуальна. Можно повторить загрузку страницы.',
  offline: 'Связь с сайтом прервалась. Проверьте подключение и повторите проверку.',
  unavailable: 'Сервер не ответил на проверку версии. Повторите проверку или загрузку страницы.',
}

export function ReloadRecovery({ reason }: { reason: 'loading' | 'chunk' | 'error' }) {
  const [status, setStatus] = useState<ReleaseStatus | null>(null)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    let active = true
    void checkRelease().then(result => { if (active) setStatus(result) })
    return () => { active = false }
  }, [])

  async function check() {
    setStatus(null)
    setStatus(await checkRelease())
  }

  function reload() {
    setBlocked(!requestPageReload(() => noteReload(`button:${reason}`)))
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm text-gray-600" role="status">
        {status ? messages[status] : 'Проверяем связь и версию сайта…'}
      </p>
      {blocked && <p role="alert" className="text-sm text-red-700">Обновление остановлено. Дождитесь сохранения ответов и файлов, затем повторите.</p>}
      {(status === 'offline' || status === 'unavailable') && (
        <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => void check()}>Проверить связь</button>
      )}
      {status && status !== 'offline' && (
        <button type="button" className="ml-1 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white" onClick={reload}>
          {status === 'updated' ? 'Обновить страницу' : 'Повторить загрузку'}
        </button>
      )}
    </div>
  )
}
