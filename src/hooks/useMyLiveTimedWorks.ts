import { useEffect, useState } from 'react'
import { safeRpc } from '@/lib/safeRpc'
import { parseLiveWorksList, type LiveWorkBrief } from '@/lib/liveWork'

/**
 * §263. Главная учителя: идущие сейчас проверочные и контрольные его курсов
 * (`my_live_timed_works`) — для кнопки «Следить». Раз в минуту, пока вкладка
 * видна. Нет функции (миграция не применена) или сбой — пусто, блок не рисуется.
 */
export function useMyLiveTimedWorks(enabled = true) {
  const [works, setWorks] = useState<LiveWorkBrief[]>([])
  const [serverNow, setServerNow] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void safeRpc('my_live_timed_works').then(({ data, error }) => {
        if (cancelled) return
        if (error) { setWorks([]); return }
        const list = parseLiveWorksList(data)
        setWorks(list)
        const first = Array.isArray(data) ? (data[0] as { server_now?: string } | undefined)?.server_now : undefined
        setServerNow(first ?? new Date().toISOString())
      })
    }
    load()
    const id = window.setInterval(load, 60_000)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [enabled])

  return { works, serverNow }
}
