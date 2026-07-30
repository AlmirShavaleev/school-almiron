import { useState } from 'react'
import { AlertTriangle, Loader2, Sparkles, SquareDashed } from 'lucide-react'
import {
  CONFIDENCE_LABEL,
  aiErrorMessage,
  shouldShowScore,
  type AiFindingRow,
  type AiJobRow,
} from '@/lib/aiHomeworkCheck'

/**
 * Панель черновика ИИ в разборе работы.
 *
 * Тон здесь важнее вёрстки. Это предложение, а не результат проверки, и
 * интерфейс обязан говорить об этом сам, без пояснений в документации:
 * отсюда «предлагает», а не «оценил», отдельная кнопка переноса рамок и
 * молчание про балл, когда модель не уверена (shouldShowScore).
 *
 * Ученик этой панели не видит никогда: RLS отдаёт topic_homework_ai_* только
 * персоналу курса.
 */
export function AiCheckPanel({
  job,
  findings,
  running,
  error,
  onRun,
  onApplyFrames,
  onUseText,
}: {
  job: AiJobRow | null
  findings: AiFindingRow[]
  running: boolean
  error: string | null
  onRun: () => void
  /** Переносит рамки ИИ в разбор. Возвращает, сколько реально легло. */
  onApplyFrames: () => Promise<number>
  /** Подставляет текст разбора в поле комментария вердикта. */
  onUseText?: (text: string) => void
}) {
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<number | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)

  const done = job?.status === 'done'
  const failed = job?.status === 'failed'
  const shownError = error ?? (failed ? aiErrorMessage(job?.last_error) : null)

  async function applyFrames() {
    setApplying(true)
    setApplyError(null)
    try {
      const count = await onApplyFrames()
      setApplied(count)
      if (count === 0) setApplyError('Ни одну рамку перенести не удалось')
    } catch (e: any) {
      setApplyError(e?.message ?? 'Не удалось перенести рамки')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div
      data-testid="ai-check-panel"
      className="rounded-xl border border-violet-200 bg-violet-50/60 p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-900">
          <Sparkles size={14} />
          Черновик ИИ
        </span>
        <button
          type="button"
          data-testid="ai-check-run"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 transition-colors hover:border-violet-400 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {running ? 'Проверяю…' : done || failed ? 'Проверить заново' : 'Проверить с ИИ'}
        </button>
      </div>

      {running && (
        <p className="mt-2 text-xs text-violet-700">
          Читаю работу и решаю задачу сам — это занимает до минуты.
        </p>
      )}

      {shownError && (
        <p data-testid="ai-check-error" className="mt-2 flex items-start gap-1.5 text-xs text-red-700">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {shownError}
        </p>
      )}

      {!running && !job && !shownError && (
        <p className="mt-2 text-xs text-violet-800">
          ИИ прочитает работу, решит задачу сам и предложит рамки, балл и текст обратной связи.
          Решение остаётся за вами — ученик увидит только то, что вы подтвердите.
        </p>
      )}

      {done && job && (
        <div className="mt-3 space-y-2.5">
          {job.readable === false && (
            <p className="rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs text-amber-900">
              ИИ не смог разобрать работу — балл не предлагается. Причина ниже.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {shouldShowScore(job) ? (
              <span
                data-testid="ai-check-score"
                className="rounded-md border border-violet-300 bg-white px-2 py-0.5 font-semibold text-violet-900"
              >
                Предлагает балл: {job.suggested_score}
              </span>
            ) : (
              <span className="rounded-md bg-white px-2 py-0.5 text-gray-500">Балл не предлагается</span>
            )}
            {job.confidence && (
              <span className="text-violet-700">{CONFIDENCE_LABEL[job.confidence]}</span>
            )}
            {findings.length > 0 && (
              <span className="text-violet-700">· нашёл мест: {findings.length}</span>
            )}
            {job.model && (
              // Подпись модели нужна, пока мы сравниваем провайдеров: без неё
              // непонятно, чей это разбор — Qwen или Gemini.
              <span data-testid="ai-check-model" className="text-violet-500">· {job.model}</span>
            )}
          </div>

          {job.summary && (
            <div className="rounded-lg border border-violet-200 bg-white p-2.5">
              <p
                data-testid="ai-check-summary"
                className="whitespace-pre-wrap text-xs leading-5 text-gray-700"
              >
                {job.summary}
              </p>
              {onUseText && (
                <button
                  type="button"
                  data-testid="ai-check-use-text"
                  onClick={() => onUseText(job.summary ?? '')}
                  className="mt-2 text-xs font-medium text-violet-700 underline-offset-2 hover:underline"
                >
                  Вставить в комментарий
                </button>
              )}
            </div>
          )}

          {findings.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="ai-check-apply-frames"
                onClick={applyFrames}
                disabled={applying || applied != null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-xs font-medium text-violet-800 transition-colors hover:border-violet-400 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {applying ? <Loader2 size={12} className="animate-spin" /> : <SquareDashed size={12} />}
                {applied != null ? `Перенесено рамок: ${applied}` : `Перенести рамки (${findings.length})`}
              </button>
              <span className="text-[11px] text-violet-700">
                Станут вашими пометками — их можно двигать и удалять.
              </span>
            </div>
          )}

          {applyError && (
            <p className="text-xs text-red-700">{applyError}</p>
          )}

          <p className="text-[11px] leading-4 text-violet-700">
            ИИ может ошибиться в чтении почерка и в самом решении. Балл и вердикт ставите вы —
            ученик ничего из этого не видит.
          </p>
        </div>
      )}
    </div>
  )
}
