import { useEffect, useState } from 'react'

export function useMockExamClock(offset = 0): number {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])
  return tick + offset
}
