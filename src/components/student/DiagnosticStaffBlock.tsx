/**
 * §289. «Стартовая диагностика» в карточке ученика (персонал): дата, верно из
 * скольких, карта номеров, слабые места, «Пройти заново». Диагностики не было
 * или нет прав — блока нет. Права решает база (`diagnostic_result_for`).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { cn } from '@/utils/cn'
import { formatDateMsk } from '@/lib/subscription/view'
import {
  STATUS_LABEL,
  fetchDiagnosticResultFor,
  resetDiagnostic,
  weakText,
  type DiagnosticResult,
  type NumberStatus,
} from '@/lib/diagnostic'

const DOT: Record<NumberStatus, string> = {
  green: 'bg-verdict-ok-tint text-verdict-ok-ink',
  yellow: 'bg-amber-50 text-amber-800',
  red: 'bg-verdict-bad-tint text-verdict-bad-ink',
  grey: 'bg-graphite-50 text-graphite-400',
}

export function DiagnosticStaffBlock({ studentId }: { studentId: string }) {
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let alive = true
    fetchDiagnosticResultFor(studentId)
      .then((r) => { if (alive) setResult(r) })
      .catch(() => { if (alive) setResult(null) })
    return () => {
      alive = false
    }
  }, [studentId, tick])

  if (!result) return null

  async function reset() {
    setBusy(true)
    try {
      await resetDiagnostic(studentId)
      setAsking(false)
      reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4" data-testid="diagnostic-staff">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-gray-900">Стартовая диагностика</h3>
        <Button variant="ghost" size="sm" onClick={() => setAsking(true)} data-testid="diagnostic-staff-reset">Пройти заново</Button>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {result.status === 'done'
          ? `Пройдена ${formatDateMsk(result.finished_at) ?? ''} · верно ${result.correct} из ${result.answered}`
          : `Идёт · отвечено ${result.answered}`}
      </p>
      <div className="mt-3 flex flex-wrap gap-1">
        {result.numbers.map((x) => (
          <span
            key={x.n}
            className={cn('inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold', DOT[x.status])}
            title={`№${x.n}${x.title ? ` · ${x.title}` : ''} — ${STATUS_LABEL[x.status]}`}
            data-status={x.status}
          >
            {x.n}
          </span>
        ))}
      </div>
      {result.weak.length > 0 && (
        <p className="mt-2 text-sm text-gray-700">Слабые места: {result.weak.map(weakText).join(', ')}</p>
      )}
      <ConfirmDialog
        open={asking}
        title="Пройти диагностику заново?"
        text="Ответы и результат удалятся, ученик пройдёт её с начала. Уроки, уже открытые по диагностике, останутся открытыми."
        confirmLabel="Сбросить"
        danger
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={reset}
        testId="diagnostic-reset-confirm"
      />
    </section>
  )
}
