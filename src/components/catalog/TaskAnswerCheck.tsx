import { useRef, useState } from 'react'
import { MinusToggle } from '@/components/ui/MinusToggle'
import { VerdictMark } from '@/components/ui/VerdictMark'
import { toast } from '@/store/toastStore'
import { cn } from '@/utils/cn'
import {
  awardChips, forecastChangeText, toastText,
  type CheckResult, type ForecastChange, type TaskPracticeState,
} from '@/lib/catalogRewards'
import type { CheckOutcome } from '@/hooks/useCatalogPractice'

/**
 * §256. Поле ответа и «Проверить» у задачи каталога с коротким ответом.
 *
 * Вердикт — только база (`catalog_check_answer`). Засчитывается первая
 * верная попытка без открытого ответа: тогда «Верно! +5 баллов школы · +1 к
 * прогнозу» и тост. Открыл ответ до проверки — «Верно, но ответ был открыт».
 * Вторая часть (развёрнутый ответ) сюда не попадает: поля для неё нет.
 */
export function TaskAnswerCheck({ taskId, state, onCheck, inputLabel = 'Ваш ответ', compact = false, solvedText, showHint = true }: {
  taskId: string
  state: TaskPracticeState | undefined
  onCheck: (answer: string) => Promise<CheckOutcome>
  inputLabel?: string
  compact?: boolean
  /** Подпись уже решённой задачи (по умолчанию — «засчитано / ответ был открыт»). */
  solvedText?: string
  /** Подсказка про открытый ответ (на главной ответа открыть нельзя — её нет). */
  showHint?: boolean
}) {
  const [answer, setAnswer] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ result: CheckResult; change: ForecastChange | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const solved = state?.solved === true
  const revealed = state?.revealed === true

  async function submit() {
    const a = answer.trim()
    if (!a) { setError('Введите ответ'); return }
    setBusy(true)
    setError(null)
    try {
      const out = await onCheck(a)
      if (out.error || !out.result) { setError(out.error ?? 'Не удалось проверить ответ'); return }
      setLast({ result: out.result, change: out.change })
      if (out.result.counted) toast.success(toastText(out.result, out.change))
    } finally {
      setBusy(false)
    }
  }

  const r = last?.result ?? null
  const inputId = `answer-${taskId}`

  return (
    <div className={cn('grid gap-2', compact ? '' : 'px-4 pb-3')} data-testid="task-answer-check">
      {!solved && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={e => { e.preventDefault(); void submit() }}
        >
          <label htmlFor={inputId} className="sr-only">{inputLabel}</label>
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <input
            ref={inputRef}
            id={inputId}
            data-testid="task-answer-input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            maxLength={200}
            value={answer}
            placeholder={inputLabel}
            onChange={e => { setAnswer(e.target.value); setError(null) }}
            className="h-10 w-full min-w-0 flex-1 rounded-xl border border-graphite-300 bg-white px-3 text-[15px] font-semibold text-graphite-950 placeholder:font-normal placeholder:text-graphite-400 focus:outline-none focus:ring-2 focus:ring-primary-400 sm:w-48 sm:flex-none"
          />
          <MinusToggle value={answer} getInput={() => inputRef.current} onChange={v => { setAnswer(v); setError(null) }} testid="task-answer-minus" />
          </div>
          <button
            type="submit"
            disabled={busy}
            data-testid="task-answer-submit"
            className="h-10 rounded-xl bg-primary-600 px-4 text-sm font-extrabold text-white shadow-action hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 disabled:opacity-60"
          >
            {busy ? 'Проверяем…' : r?.verdict === 'wrong' ? 'Проверить ещё раз' : 'Проверить'}
          </button>
        </form>
      )}

      {error && <p role="alert" className="text-sm font-semibold text-verdict-bad-ink">{error}</p>}

      {r && <ResultLine result={r} change={last?.change ?? null} />}

      {!r && solved && (
        <div data-testid="task-answer-result" data-verdict="correct" className="flex flex-wrap items-center gap-2 rounded-xl bg-verdict-ok-tint px-3 py-2 text-sm font-bold text-verdict-ok-ink">
          <VerdictMark state="ok" size={18} label={null} />
          {solvedText ?? (state?.counted ? 'Решено — засчитано в прогноз и баллы' : 'Решено, но ответ был открыт — в прогноз и баллы не пошло')}
        </div>
      )}

      {!solved && showHint && (
        <p data-testid="task-answer-hint" className="text-xs text-graphite-500">
          {revealed
            ? 'Ответ открыт — эта задача в прогноз и баллы уже не пойдёт. Возьмите следующую.'
            : 'Если открыть ответ или решение до проверки, задача в прогноз и баллы не пойдёт.'}
        </p>
      )}
    </div>
  )
}

function ResultLine({ result: r, change }: { result: CheckResult; change: ForecastChange | null }) {
  if (r.verdict === 'wrong') {
    return (
      <div role="status" data-testid="task-answer-result" data-verdict="wrong" className="flex flex-wrap items-center gap-2 rounded-xl bg-verdict-bad-tint px-3 py-2 text-sm font-bold text-verdict-bad-ink">
        <VerdictMark state="bad" size={18} label={null} />
        Пока неверно. Попробуйте ещё раз или откройте решение.
      </div>
    )
  }
  if (!r.counted) {
    return (
      <div role="status" data-testid="task-answer-result" data-verdict="correct" data-counted="false" className="flex flex-wrap items-center gap-2 rounded-xl bg-verdict-ok-tint px-3 py-2 text-sm font-bold text-verdict-ok-ink">
        <VerdictMark state="ok" size={18} label={null} />
        {r.alreadySolved ? 'Верно — эта задача уже решена' : 'Верно, но ответ был открыт — в прогноз и баллы не идёт'}
      </div>
    )
  }
  const chips = awardChips(r)
  return (
    <div role="status" data-testid="task-answer-result" data-verdict="correct" data-counted="true" className="flex flex-wrap items-center gap-2 rounded-xl bg-verdict-ok-tint px-3 py-2 text-sm font-bold text-verdict-ok-ink">
      <VerdictMark state="ok" size={18} label={null} />
      Верно!
      {chips.map(c => (
        <span key={c} className="whitespace-nowrap rounded-full bg-gold-100 px-2.5 py-0.5 text-xs font-extrabold text-gold-800">{c}</span>
      ))}
      {change && (
        <span data-testid="task-answer-forecast" className="whitespace-nowrap rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-extrabold text-primary-700">
          {forecastChangeText(change)}
        </span>
      )}
    </div>
  )
}
