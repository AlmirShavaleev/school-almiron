import { useEffect, useState } from 'react'
import { safeRpc } from '@/lib/safeRpc'
import { parseMockAway } from '@/lib/liveWork'

/**
 * §263. Уходы учеников со страницы идущего пробника (`mock_exam_away`) — для
 * монитора §224. Перечитывается вместе с монитором (каждый новый ответ
 * `mock_exam_live`), отдельного опроса нет. Нет функции или сбой — пусто.
 */
export function useMockExamAway(examId: string | undefined, liveTick: unknown) {
  const [away, setAway] = useState<Record<string, { count: number; seconds: number }>>({})
  useEffect(() => {
    if (!examId || !liveTick) return
    let cancelled = false
    void safeRpc('mock_exam_away', { p_mock_exam_id: examId }).then(({ data, error }) => {
      // Сбой — монитор живёт и без уходов.
      if (!cancelled && !error) setAway(parseMockAway(data))
    })
    return () => { cancelled = true }
  }, [examId, liveTick])
  return away
}
