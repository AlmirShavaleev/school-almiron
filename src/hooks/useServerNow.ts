import { useEffect, useMemo, useState } from 'react'
import { clockOffset } from '@/lib/mockExamLesson'

/**
 * «Сейчас» по часам базы: `server_now` из ответа минус смещение часов
 * устройства, обновляется раз в `periodMs`. Переведённые часы телефона
 * меняют только цифры, а не то, какой пробник «идёт» (§221).
 *
 * Смещение пересчитывается, когда приходит новый `server_now` (список
 * перечитан), — раньше оно запоминалось один раз при первом рендере, и
 * список, пришедший позже, жил по часам телефона.
 */
export function useServerNow(serverNow: string | null | undefined, periodMs = 15_000): number {
  const offset = useMemo(() => (serverNow ? clockOffset(serverNow, Date.now()) : 0), [serverNow])
  const [tick, setTick] = useState(() => ({ now: Date.now() + offset, offset }))
  // Новое смещение — сразу новое «сейчас», в том же рендере (без эффекта и
  // лишней перерисовки).
  if (tick.offset !== offset) setTick({ now: Date.now() + offset, offset })
  useEffect(() => {
    const id = setInterval(() => setTick({ now: Date.now() + offset, offset }), periodMs)
    return () => clearInterval(id)
  }, [offset, periodMs])
  return tick.offset === offset ? tick.now : Date.now() + offset
}
