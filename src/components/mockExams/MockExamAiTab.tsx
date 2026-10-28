import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, AlertTriangle, ChevronRight, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { MockExamAi } from '@/hooks/useMockExamAi'
import { AI_CONCURRENCY } from '@/hooks/useMockExamAi'
import {
  AI_CONFIDENCE_LABEL, aiProgress, aiReferenceWarnings, aiTabRows, isAiActive,
  type AiRefVariant, type AiTabRow, type AiTabStudent,
} from '@/lib/mockExamAi'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * Вкладка «Проверка ИИ» пробника (письмо ЛК_пробник_вкладка_Проверка_ИИ.md,
 * 28.10). Полосу §222b над «Работами» не замечали: владелец не понял, как
 * проверять через ИИ, и по пробнику с пятью работами на фото ИИ не запускали
 * ни разу. Здесь всё про ИИ в одном месте:
 *
 * - крупная кнопка «у всех» с пояснением, что баллы ИИ — только предложения;
 * - предупреждение, если у варианта нет решения или критериев (ИИ проверит хуже);
 * - таблица по ученикам: вариант, фото, статус, предложения по номерам второй
 *   части с уверенностью, «Проверить ИИ» / «Повторить» и «Открыть проверку».
 *
 * «У всех» — заявка в очередь `mock_exam_ai_request_check` разом (статусы «в
 * очереди» появляются сразу), а вызовы функции ИИ — не больше AI_CONCURRENCY
 * одновременно (`useMockExamAi`): больше — воркер Edge Functions убивает.
 * Ученик ничего из этого не видит.
 */
export interface AiTabStudentFull extends AiTabStudent {
  variant?: { id: string } | null
}

export function MockExamAiTab({ examId, ai, students, part1Last, maxPoints, examSolutionPath, variants, variantById }: {
  examId: string
  ai: MockExamAi
  students: readonly AiTabStudentFull[]
  part1Last: number
  maxPoints: readonly number[]
  examSolutionPath: string | null
  variants: readonly AiRefVariant[]
  variantById?: Record<string, string>
}) {
  const [busyAll, setBusyAll] = useState(false)
  const [busyOne, setBusyOne] = useState<ReadonlySet<string>>(new Set())
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  if (!ai.available) {
    return <p className="py-4 text-sm text-graphite-600" data-testid="mock-ai-tab-unavailable">Проверка ИИ сейчас недоступна.</p>
  }
  if (part1Last >= maxPoints.length) {
    return <p className="py-4 text-sm text-graphite-600" data-testid="mock-ai-tab-no-part2">У этого пробника нет второй части — ИИ проверять нечего.</p>
  }

  const p = aiProgress(students, ai.suggestions, ai.runs, ai.now)
  const rows = aiTabRows(students, ai.suggestions, ai.runs, ai.now, part1Last, maxPoints)
  const withPhotos = students.filter(s => s.photos > 0)
  const warnings = aiReferenceWarnings({
    examSolutionPath,
    variants,
    usedVariantIds: new Set(withPhotos.flatMap(s => (s.variant?.id ? [s.variant.id] : []))),
    anyPhotos: withPhotos.length > 0,
  })
  const running = busyAll || p.active > 0

  async function checkAll() {
    setBusyAll(true)
    setStatus(null)
    const r = await ai.request(p.toCheck)
    setBusyAll(false)
    if (r.error && r.queued.length === 0) { setStatus({ kind: 'error', text: `Не запустилось: ${r.error}` }); return }
    setStatus({
      kind: 'ok',
      text: r.queued.length > 0
        ? `ИИ проверил ${r.queued.length} ${plural(r.queued.length, 'работу', 'работы', 'работ')}. Баллы — только предложения: примите их на экране проверки.`
        : 'Проверять некого — у всех с фото проверка уже есть или идёт.',
    })
  }

  async function checkOne(id: string) {
    setBusyOne(prev => new Set([...prev, id]))
    setStatus(null)
    const r = await ai.request([id])
    setBusyOne(prev => { const nx = new Set(prev); nx.delete(id); return nx })
    if (r.error) setStatus({ kind: 'error', text: `Не запустилось: ${r.error}` })
  }

  return (
    <div className="space-y-4 py-4" data-testid="mock-ai-tab">
      <div className="flex flex-col gap-3 rounded-card bg-primary-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-graphite-900" data-testid="mock-ai-tab-progress">
            {running ? <Loader2 size={18} className="animate-spin text-primary-600" aria-hidden /> : <Sparkles size={18} className="text-primary-600" aria-hidden />}
            Проверено ИИ: {p.checked} из {p.of}
            {p.active > 0 && <span className="font-normal text-graphite-500">· идёт: {p.active}</span>}
            {p.failed > 0 && <span className="font-normal text-verdict-bad-ink">· с ошибкой: {p.failed}</span>}
          </p>
          <p className="text-sm text-graphite-600">
            ИИ ставит баллы-предложения по {part1Last + 1}–{maxPoints.length} по решению и критериям варианта; ученик их не видит, вы принимаете на экране проверки.
          </p>
        </div>
        <Button size="lg" onClick={checkAll} loading={busyAll} disabled={running || p.toCheck.length === 0} className="shrink-0"
          data-testid="mock-ai-tab-check-all"
          title={p.toCheck.length === 0 ? 'У всех с фото проверка уже есть или идёт' : `По ${AI_CONCURRENCY} работы одновременно, остальные ждут в очереди`}>
          Проверить вторую часть ИИ — у всех ({p.toCheck.length})
        </Button>
      </div>

      {warnings.map(w => (
        <p key={w} className="flex items-start gap-2 rounded-lg bg-verdict-part-tint px-3 py-2 text-sm text-verdict-part-ink" data-testid="mock-ai-tab-warning">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />{w}
        </p>
      ))}

      {status && (
        <p role="status" data-testid="mock-ai-tab-status" className={cn('flex items-start gap-2 text-sm', status.kind === 'error' ? 'text-verdict-bad-ink' : 'text-verdict-ok-ink')}>
          {status.kind === 'error' && <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />}{status.text}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm" data-testid="mock-ai-tab-table">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-graphite-500">
              <th className="border-b border-graphite-200 px-2.5 py-2 font-semibold">Ученик</th>
              <th className="border-b border-graphite-200 px-2.5 py-2 font-semibold">Фото</th>
              <th className="border-b border-graphite-200 px-2.5 py-2 font-semibold">ИИ</th>
              <th className="border-b border-graphite-200 px-2.5 py-2 font-semibold">Предложения ИИ</th>
              <th className="border-b border-graphite-200 px-2.5 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <AiRow key={r.id} row={r} examId={examId} variant={variantById?.[r.id]}
                busy={busyOne.has(r.id) || ai.inFlight.has(r.id)} onRun={() => checkOne(r.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const BADGE: Record<AiTabRow['badge']['tone'], string> = {
  muted: 'bg-graphite-100 text-graphite-600',
  busy: 'bg-primary-50 text-primary-700',
  ok: 'bg-verdict-ok-tint text-verdict-ok-ink',
  error: 'bg-verdict-bad-tint text-verdict-bad-ink',
}

/** Значок статуса ИИ — в таблице вкладки и в строке «Работ». */
export function AiBadge({ badge, title }: { badge: AiTabRow['badge']; title?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-xs font-semibold', BADGE[badge.tone])}
      data-testid="mock-ai-badge" data-tone={badge.tone} title={title}>
      {badge.tone === 'busy' ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <Sparkles size={11} aria-hidden />}
      ИИ: {badge.label}
    </span>
  )
}

function AiRow({ row, examId, variant, busy, onRun }: { row: AiTabRow; examId: string; variant?: string; busy: boolean; onRun: () => void }) {
  return (
    <tr data-testid="mock-ai-tab-row" data-student={row.id} data-state={row.state} className="align-top">
      <td className="border-b border-graphite-200 px-2.5 py-3">
        <div className="font-bold text-graphite-900">{row.name}</div>
        {variant && <div className="text-xs text-graphite-500">{variant}</div>}
      </td>
      <td className="border-b border-graphite-200 px-2.5 py-3 text-graphite-700">{row.photos > 0 ? row.photos : <span className="text-graphite-400">нет</span>}</td>
      <td className="border-b border-graphite-200 px-2.5 py-3">
        <AiBadge badge={row.badge} />
        {row.error && <div className="mt-1 max-w-[16rem] text-xs text-verdict-bad-ink" data-testid="mock-ai-tab-error">{row.error}</div>}
      </td>
      <td className="border-b border-graphite-200 px-2.5 py-3">
        {row.tasks.some(t => t.suggestion) ? (
          <div className="flex flex-wrap gap-1.5" data-testid="mock-ai-tab-points">
            {row.tasks.map(t => (
              <span key={t.task} title={t.suggestion ? AI_CONFIDENCE_LABEL[t.suggestion.confidence] : 'нет предложения'}
                className={cn('inline-flex items-baseline gap-1 rounded-md px-1.5 py-0.5 text-xs',
                  !t.suggestion ? 'bg-graphite-50 text-graphite-400'
                    : t.suggestion.confidence === 'high' ? 'bg-verdict-ok-tint text-verdict-ok-ink'
                      : t.suggestion.confidence === 'medium' ? 'bg-gold-100 text-gold-800' : 'bg-verdict-part-tint text-verdict-part-ink')}
                data-testid="mock-ai-tab-task" data-task={t.task} data-confidence={t.suggestion?.confidence ?? ''}>
                <span className="font-semibold">№{t.task}</span>
                {t.suggestion ? `${t.suggestion.points}/${t.max}` : '—'}
                {t.suggestion && t.suggestion.confidence !== 'high' && <span aria-hidden>{t.suggestion.confidence === 'medium' ? '?' : '??'}</span>}
              </span>
            ))}
          </div>
        ) : <span className="text-graphite-400">{isAiActive(row.state) ? 'ждём ответ…' : '—'}</span>}
      </td>
      <td className="border-b border-graphite-200 px-2.5 py-3 text-right">
        <div className="flex flex-wrap justify-end gap-2">
          {row.photos > 0 && (
            <Button size="sm" variant="secondary" onClick={onRun} loading={busy} disabled={!row.canRun || busy} data-testid="mock-ai-tab-run">
              {row.runLabel}
            </Button>
          )}
          <Link to={`/mock-exams/${examId}/review/${row.id}`}
            className="inline-flex min-h-9 items-center gap-0.5 whitespace-nowrap rounded-lg px-2 text-sm font-semibold text-primary-700 hover:bg-primary-50"
            data-testid="mock-ai-tab-open">
            Открыть проверку<ChevronRight size={14} aria-hidden />
          </Link>
        </div>
      </td>
    </tr>
  )
}
