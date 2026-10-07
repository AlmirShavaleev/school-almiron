import { useState } from 'react'
import { AlertCircle, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { MockExamAi } from '@/hooks/useMockExamAi'
import { aiProgress, type AiProgressStudent } from '@/lib/mockExamAi'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * §222b. Полоса над «Работами»: «Вторая часть · ИИ: проверено N из M» и кнопка
 * «Проверить вторую часть ИИ — у всех» — ученики с фото второй части, у кого
 * ещё нет предложений и проверка не идёт. Баллы ИИ — только предложения: их
 * принимают на экране проверки работы; ученик ничего не видит и не получает.
 */
export function MockExamAiBar({ ai, students }: { ai: MockExamAi; students: AiProgressStudent[] }) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const p = aiProgress(students, ai.suggestions, ai.runs, ai.now)
  if (!ai.available || p.of === 0) return null
  const running = busy || p.active > 0

  async function checkAll() {
    setBusy(true)
    setStatus(null)
    const ids = p.toCheck
    const r = await ai.request(ids)
    setBusy(false)
    if (r.error && r.queued.length === 0) { setStatus({ kind: 'error', text: `Не запустилось: ${r.error}` }); return }
    setStatus({ kind: 'ok', text: r.queued.length > 0 ? `ИИ проверил ${r.queued.length} ${plural(r.queued.length, 'работу', 'работы', 'работ')}. Баллы — только предложения: примите их на экране проверки.` : 'Проверять некого — у всех с фото проверка уже есть или идёт.' })
  }

  return (
    <div className="my-3 flex flex-col gap-2 rounded-card bg-primary-50 px-4 py-3" data-testid="mock-ai-bar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm text-graphite-900" data-testid="mock-ai-progress">
          {running ? <Loader2 size={16} className="animate-spin text-primary-600" aria-hidden /> : <Sparkles size={16} className="text-primary-600" aria-hidden />}
          <span>Вторая часть · ИИ: проверено <b>{p.checked}</b> из {p.of}</span>
          {p.active > 0 && <span className="text-graphite-500">· идёт: {p.active}</span>}
          {p.failed > 0 && <span className="text-verdict-bad-ink">· с ошибкой: {p.failed}</span>}
        </span>
        <Button size="sm" onClick={checkAll} loading={busy} disabled={running || p.toCheck.length === 0} data-testid="mock-ai-check-all"
          title={p.toCheck.length === 0 ? 'У всех с фото проверка уже есть или идёт' : 'Учеников с фото второй части и без предложений ИИ'}>
          Проверить вторую часть ИИ — у всех{p.toCheck.length > 0 ? ` · ${p.toCheck.length}` : ''}
        </Button>
      </div>
      {status && (
        <p role="status" data-testid="mock-ai-status" className={cn('flex items-start gap-2 text-sm', status.kind === 'error' ? 'text-verdict-bad-ink' : 'text-verdict-ok-ink')}>
          {status.kind === 'error' && <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />}{status.text}
        </p>
      )}
    </div>
  )
}
