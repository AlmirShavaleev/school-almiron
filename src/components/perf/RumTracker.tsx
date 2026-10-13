/**
 * §291. Включает RUM (один раз) и сообщает ему о смене маршрута. Ничего не
 * рисует. Стоит внутри BrowserRouter.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { routeChanged, startRum } from '@/lib/perf/rum'
import { rumTransport } from '@/lib/perf/rumTransport'

export function RumTracker() {
  const { pathname } = useLocation()
  useEffect(() => startRum(rumTransport), [])
  useEffect(() => { routeChanged(pathname) }, [pathname])
  return null
}
