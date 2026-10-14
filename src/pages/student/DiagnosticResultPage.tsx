/**
 * §289. Результат стартовой диагностики (`/diagnostic/result`).
 *
 * Стартовый прогноз — тот же расчёт, что «Примерный балл» (база
 * `student_exam_forecast_evidence` → `buildForecastView`), цель из анкеты
 * рядом; карта №1–20 (зелёный / жёлтый / красный / серый); 3 слабых места
 * словами; личный план; «Начать 3 дня бесплатно» → «Курсы». Внизу — разбор
 * «твой ответ / верный ответ» (во время теста его не было — решение владельца).
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Check, Minus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { TaskContentRenderer } from '@/components/catalog/TaskContentRenderer'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { cn } from '@/utils/cn'
import { supabase } from '@/lib/supabase'
import { activeSpec } from '@/lib/egeScales'
import { buildForecastView, normalizeForecastResponse, type ForecastView } from '@/lib/egeForecast'
import {
  STATUS_LABEL,
  fetchDiagnosticResult,
  studyPlan,
  weakText,
  type DiagnosticAnswerRow,
  type DiagnosticResult,
  type NumberStatus,
} from '@/lib/diagnostic'

const TILE: Record<NumberStatus, string> = {
  green: 'bg-verdict-ok-tint text-verdict-ok-ink border-verdict-ok-ink/20',
  yellow: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-verdict-bad-tint text-verdict-bad-ink border-verdict-bad-ink/20',
  grey: 'bg-graphite-50 text-graphite-400 border-graphite-200',
}

/** Стартовый прогноз по предмету: undefined — считаем, null — нет данных или сбой. */
function useStartForecast(subject: string | null) {
  const [got, setGot] = useState<{ subject: string; view: ForecastView | null } | null>(null)
  useEffect(() => {
    if (!subject) return
    let alive = true
    const done = (view: ForecastView | null) => { if (alive) setGot({ subject, view }) }
    supabase.rpc('student_exam_forecast_evidence' as never).then(({ data, error }) => {
      const res = error ? null : normalizeForecastResponse(data)
      const spec = activeSpec(subject)
      done(res && spec ? buildForecastView(spec, res.evidence, res.now) : null)
    }, () => done(null))
    return () => {
      alive = false
    }
  }, [subject])
  return got && got.subject === subject ? got.view : undefined
}

function AnswerRow({ a }: { a: DiagnosticAnswerRow }) {
  const html = useMemo(() => resolveTaskHtml(a.statement_html, a.assets), [a])
  const correctHtml = useMemo(() => resolveTaskHtml(a.correct_html, a.assets), [a])
  const icon = a.verdict === 'correct'
    ? <Check size={16} className="text-verdict-ok" aria-label="верно" />
    : a.verdict === 'dont_know' ? <Minus size={16} className="text-graphite-400" aria-label="не знаю" />
      : <X size={16} className="text-verdict-bad" aria-label="неверно" />
  return (
    <details className="rounded-xl border border-graphite-200 bg-white p-3" data-testid="diagnostic-answer-row">
      <summary className="flex cursor-pointer items-center gap-2 text-[15px] text-graphite-900">
        {icon}
        <span className="font-medium">№{a.n}</span>
        <span className="truncate text-graphite-500">{a.title}</span>
      </summary>
      <div className="mt-3 min-w-0 overflow-x-auto text-[15px]"><TaskContentRenderer html={html} /></div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[15px]">
        <dt className="text-graphite-500">Твой ответ</dt>
        <dd className="text-graphite-900" data-testid="diagnostic-my-answer">{a.verdict === 'dont_know' ? '«Не знаю»' : a.answer ?? '—'}</dd>
        <dt className="text-graphite-500">Верный ответ</dt>
        <dd className="min-w-0 text-graphite-900" data-testid="diagnostic-correct-answer"><TaskContentRenderer html={correctHtml} /></dd>
      </dl>
    </details>
  )
}

export function DiagnosticResultPage() {
  const [result, setResult] = useState<DiagnosticResult | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    fetchDiagnosticResult().then((r) => { if (alive) setResult(r) }).catch(() => { if (alive) setResult(null) })
    return () => {
      alive = false
    }
  }, [])
  const forecast = useStartForecast(result?.status === 'done' ? result.subject : null)

  if (result === undefined) return <p className="p-6 text-graphite-500">Загружаем…</p>
  if (!result || result.status !== 'done') return <Navigate to="/diagnostic" replace />

  const plan = studyPlan(result.onboarding?.hours_per_week, result.weak)
  const target = result.onboarding?.target_score ?? null

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6" data-testid="diagnostic-result">
      <div>
        <h1 className="text-[28px] font-semibold text-graphite-900">Результат диагностики</h1>
        <p className="mt-1 text-[15px] text-graphite-500">Верно {result.correct} из {result.answered}</p>
      </div>

      <section className="platform-surface rounded-card p-5" data-testid="diagnostic-forecast">
        <p className="text-xs font-medium uppercase tracking-[.03em] text-graphite-500">Стартовый прогноз</p>
        {forecast === undefined ? (
          <p className="mt-1 text-[15px] text-graphite-500">Считаем…</p>
        ) : forecast?.current.ready ? (
          <p className="mt-1 text-[28px] font-semibold text-graphite-900">
            {forecast.low}–{forecast.high} <span className="text-[15px] font-normal text-graphite-500">баллов</span>
          </p>
        ) : (
          <p className="mt-1 text-[15px] text-graphite-700">Прогноз считается — он появится вместе с первыми темами.</p>
        )}
        {target != null && <p className="mt-1 text-[15px] text-graphite-700">Ваша цель — {target}.</p>}
      </section>

      <section className="platform-surface rounded-card p-5">
        <h2 className="text-[17px] font-semibold text-graphite-900">Задания первой части</h2>
        <div className="mt-3 grid grid-cols-5 gap-2" data-testid="diagnostic-map">
          {result.numbers.map((x) => (
            <div
              key={x.n}
              className={cn('flex min-h-11 items-center justify-center rounded-lg border text-[15px] font-semibold', TILE[x.status])}
              title={`№${x.n}${x.title ? ` · ${x.title}` : ''} — ${STATUS_LABEL[x.status]}`}
              data-status={x.status}
              data-testid="diagnostic-tile"
            >
              {x.n}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-graphite-500">
          Зелёный — уверенно, жёлтый — есть пробелы, красный — нужно разобрать, серый — не проверяли.
        </p>
      </section>

      {result.weak.length > 0 && (
        <section className="platform-surface rounded-card p-5">
          <h2 className="text-[17px] font-semibold text-graphite-900">Слабые места</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[15px] text-graphite-900" data-testid="diagnostic-weak">
            {result.weak.map((w) => <li key={w.n}>{weakText(w)}</li>)}
          </ol>
        </section>
      )}

      <section className="platform-surface rounded-card p-5">
        <h2 className="text-[17px] font-semibold text-graphite-900">Ваш план</h2>
        <p className="mt-2 text-[15px] text-graphite-700" data-testid="diagnostic-plan">{plan.text}</p>
        <Link to={`/courses?from=diagnostic&subject=${result.subject}`} className="mt-4 inline-block">
          <Button data-testid="diagnostic-start-course">Начать 3 дня бесплатно</Button>
        </Link>
      </section>

      {result.answers.length > 0 && (
        <section>
          <h2 className="text-[17px] font-semibold text-graphite-900">Разбор ответов</h2>
          <div className="mt-2 space-y-2">
            {result.answers.map((a, i) => <AnswerRow key={`${a.n}-${i}`} a={a} />)}
          </div>
        </section>
      )}
    </div>
  )
}
